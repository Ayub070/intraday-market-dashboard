import { describe, expect, it, vi } from 'vitest';

import {
  createYahooClient,
  YAHOO_USER_AGENT,
  YahooMalformedResponseError,
  YahooNetworkError,
  YahooNoDataError,
  YahooRateLimitError,
  YahooTimeoutError,
} from './yahooClient.js';

function yahooResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
      status,
    }),
  );
}

describe('Yahoo client', () => {
  it('uses the fixed host, encoded symbol, required query, and User-Agent', async () => {
    const chartResult = { meta: { symbol: 'BRK.B' } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        yahooResponse({ chart: { error: null, result: [chartResult] } }),
      );
    const client = createYahooClient({ fetchImplementation: fetchMock });

    await expect(client.getIntradayChart('BRK.B')).resolves.toEqual(
      chartResult,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];

    if (call === undefined) {
      throw new Error('Expected a Yahoo fetch call.');
    }

    const [input, init] = call;
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const headers = new Headers(init?.headers);

    expect(url.origin).toBe('https://query1.finance.yahoo.com');
    expect(url.pathname).toBe('/v8/finance/chart/BRK%2EB');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      includePrePost: 'false',
      interval: '15m',
      range: '1mo',
    });
    expect(headers.get('User-Agent')).toBe(YAHOO_USER_AGENT);
  });

  it('uses Yahoo error information to identify an unknown or no-data symbol', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      yahooResponse(
        {
          chart: {
            error: {
              code: 'Not Found',
              description: 'No data found, symbol may be delisted',
            },
            result: null,
          },
        },
        404,
      ),
    );
    const client = createYahooClient({ fetchImplementation: fetchMock });

    await expect(client.getIntradayChart('UNKNOWN')).rejects.toBeInstanceOf(
      YahooNoDataError,
    );
  });

  it('treats a null result without supporting Yahoo error information as malformed', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        yahooResponse({ chart: { error: null, result: null } }),
      );
    const client = createYahooClient({ fetchImplementation: fetchMock });

    await expect(client.getIntradayChart('TSLA')).rejects.toBeInstanceOf(
      YahooMalformedResponseError,
    );
  });

  it('maps an HTTP 429 to a rate-limit error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        yahooResponse({ chart: { error: null, result: null } }, 429),
      );
    const client = createYahooClient({ fetchImplementation: fetchMock });

    await expect(client.getIntradayChart('TSLA')).rejects.toBeInstanceOf(
      YahooRateLimitError,
    );
  });

  it('maps a rejected fetch to a network error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const client = createYahooClient({ fetchImplementation: fetchMock });

    await expect(client.getIntradayChart('TSLA')).rejects.toBeInstanceOf(
      YahooNetworkError,
    );
  });

  it('keeps the timeout active while reading the response body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        const signal = init?.signal;

        return Promise.resolve({
          status: 200,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
            }),
        } as Response);
      });
    const client = createYahooClient({
      fetchImplementation: fetchMock,
      timeoutMs: 5,
    });

    await expect(client.getIntradayChart('TSLA')).rejects.toBeInstanceOf(
      YahooTimeoutError,
    );
  });
});
