import type { RequestHandler } from 'express';

import {
  aggregateDailyData,
  MarketDataValidationError,
  UnsupportedGranularityError,
} from '../market-data/aggregateDailyData.js';
import {
  type YahooClient,
  YahooMalformedResponseError,
  YahooNetworkError,
  YahooNoDataError,
  YahooRateLimitError,
  YahooTimeoutError,
  YahooUpstreamError,
} from '../market-data/yahooClient.js';

const SYMBOL_PATTERN = /^(?=.{1,20}$)(?=.*[A-Z0-9])[A-Z0-9.^=-]+$/;

interface IntradayRouteDependencies {
  readonly now: () => Date;
  readonly yahooClient: YahooClient;
}

interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export function normalizeSymbol(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();

  return SYMBOL_PATTERN.test(normalized) ? normalized : undefined;
}

function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function createIntradayHandler({
  now,
  yahooClient,
}: IntradayRouteDependencies): RequestHandler {
  return async (request, response) => {
    const rawSymbol = request.params.symbol;
    const symbol =
      typeof rawSymbol === 'string' ? normalizeSymbol(rawSymbol) : undefined;

    if (symbol === undefined) {
      response
        .status(400)
        .json(
          apiError(
            'INVALID_SYMBOL_FORMAT',
            'Symbol must be 1-20 characters using letters, numbers, dot, hyphen, caret, or equals.',
          ),
        );
      return;
    }

    try {
      const chartResult = await yahooClient.getIntradayChart(symbol);
      const result = aggregateDailyData(chartResult, now());

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof YahooNoDataError) {
        response
          .status(404)
          .json(
            apiError(
              'SYMBOL_NOT_FOUND_OR_NO_DATA',
              'No intraday data was found for that symbol.',
            ),
          );
        return;
      }

      if (error instanceof UnsupportedGranularityError) {
        response
          .status(422)
          .json(
            apiError(
              'INTRADAY_DATA_UNAVAILABLE',
              'Yahoo did not return 15-minute intraday data for that symbol.',
            ),
          );
        return;
      }

      if (
        error instanceof YahooMalformedResponseError ||
        error instanceof MarketDataValidationError
      ) {
        response
          .status(502)
          .json(
            apiError(
              'UPSTREAM_MALFORMED_RESPONSE',
              'Yahoo returned an unexpected market-data response.',
            ),
          );
        return;
      }

      if (error instanceof YahooRateLimitError) {
        response
          .status(503)
          .json(
            apiError(
              'UPSTREAM_RATE_LIMITED',
              'Yahoo is rate limiting market-data requests. Try again later.',
            ),
          );
        return;
      }

      if (error instanceof YahooTimeoutError) {
        response
          .status(504)
          .json(
            apiError(
              'UPSTREAM_TIMEOUT',
              'The Yahoo market-data request timed out.',
            ),
          );
        return;
      }

      if (
        error instanceof YahooNetworkError ||
        error instanceof YahooUpstreamError
      ) {
        response
          .status(502)
          .json(
            apiError(
              'UPSTREAM_UNAVAILABLE',
              'Yahoo market data is currently unavailable.',
            ),
          );
        return;
      }

      response
        .status(500)
        .json(
          apiError('INTERNAL_ERROR', 'An unexpected server error occurred.'),
        );
    }
  };
}
