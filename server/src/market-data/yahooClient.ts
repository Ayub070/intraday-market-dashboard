const YAHOO_CHART_ORIGIN = 'https://query1.finance.yahoo.com';
const YAHOO_CHART_PATH = '/v8/finance/chart/';
const DEFAULT_TIMEOUT_MS = 10_000;

export const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

type FetchImplementation = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export interface YahooClient {
  getIntradayChart(symbol: string): Promise<unknown>;
}

export interface YahooClientOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly timeoutMs?: number;
}

export class YahooNoDataError extends Error {
  constructor() {
    super('Yahoo returned no data for the requested symbol.');
    this.name = 'YahooNoDataError';
  }
}

export class YahooMalformedResponseError extends Error {
  constructor(message = 'Yahoo returned a malformed response.') {
    super(message);
    this.name = 'YahooMalformedResponseError';
  }
}

export class YahooRateLimitError extends Error {
  constructor() {
    super('Yahoo rate limited the request.');
    this.name = 'YahooRateLimitError';
  }
}

export class YahooNetworkError extends Error {
  constructor() {
    super('The Yahoo request failed at the network layer.');
    this.name = 'YahooNetworkError';
  }
}

export class YahooTimeoutError extends Error {
  constructor() {
    super('The Yahoo request timed out.');
    this.name = 'YahooTimeoutError';
  }
}

export class YahooUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Yahoo returned HTTP ${status}.`);
    this.name = 'YahooUpstreamError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getYahooError(payload: unknown): UnknownRecord | undefined {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    return undefined;
  }

  return isRecord(payload.chart.error) ? payload.chart.error : undefined;
}

function isNoDataError(error: UnknownRecord | undefined): boolean {
  if (error === undefined) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const description =
    typeof error.description === 'string'
      ? error.description.toLowerCase()
      : '';

  return (
    code.includes('not found') ||
    description.includes('no data found') ||
    description.includes('symbol may be delisted')
  );
}

function parsePayload(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new YahooMalformedResponseError('Yahoo returned invalid JSON.');
  }
}

function extractChartResult(payload: unknown, status: number): unknown {
  const yahooError = getYahooError(payload);

  if (isNoDataError(yahooError)) {
    throw new YahooNoDataError();
  }

  if (status < 200 || status >= 300) {
    throw new YahooUpstreamError(status);
  }

  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw new YahooMalformedResponseError();
  }

  if (yahooError !== undefined) {
    throw new YahooUpstreamError(status);
  }

  const result = payload.chart.result;

  if (
    !Array.isArray(result) ||
    result.length === 0 ||
    result[0] === undefined
  ) {
    throw new YahooMalformedResponseError(
      'Yahoo returned no chart result and no no-data error.',
    );
  }

  return result[0];
}

function createChartUrl(symbol: string): URL {
  const encodedSymbol = encodeURIComponent(symbol).replaceAll('.', '%2E');
  const url = new URL(
    `${YAHOO_CHART_ORIGIN}${YAHOO_CHART_PATH}${encodedSymbol}`,
  );

  url.searchParams.set('range', '1mo');
  url.searchParams.set('interval', '15m');
  url.searchParams.set('includePrePost', 'false');

  return url;
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number.');
  }
}

export function createYahooClient({
  fetchImplementation = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: YahooClientOptions = {}): YahooClient {
  validateTimeout(timeoutMs);

  return {
    async getIntradayChart(symbol: string): Promise<unknown> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let body: string;

      try {
        response = await fetchImplementation(createChartUrl(symbol), {
          headers: {
            'User-Agent': YAHOO_USER_AGENT,
          },
          signal: controller.signal,
        });
        body = await response.text();
      } catch {
        if (controller.signal.aborted) {
          throw new YahooTimeoutError();
        }

        throw new YahooNetworkError();
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 429) {
        throw new YahooRateLimitError();
      }

      return extractChartResult(parsePayload(body), response.status);
    },
  };
}
