import type { Server } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { YahooClient } from '../market-data/yahooClient.js';
import {
  YahooMalformedResponseError,
  YahooNetworkError,
  YahooNoDataError,
  YahooRateLimitError,
  YahooTimeoutError,
  YahooUpstreamError,
} from '../market-data/yahooClient.js';

interface TestResponse {
  readonly body: unknown;
  readonly status: number;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function requestApp(
  yahooClient: YahooClient,
  path: string,
  now = new Date('2026-09-16T14:00:00Z'),
): Promise<TestResponse> {
  const app = createApp({ now: () => now, yahooClient });
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1');
    candidate.once('listening', () => resolve(candidate));
    candidate.once('error', reject);
  });

  try {
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP address for the integration server.');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);

    return {
      body: (await response.json()) as unknown,
      status: response.status,
    };
  } finally {
    await closeServer(server);
  }
}

function mockedClient(result: unknown): {
  readonly client: YahooClient;
  readonly getIntradayChart: ReturnType<typeof vi.fn>;
} {
  const getIntradayChart = vi.fn().mockResolvedValue(result);

  return {
    client: { getIntradayChart },
    getIntradayChart,
  };
}

describe('GET /api/stocks/:symbol/intraday', () => {
  it('normalizes the symbol and returns the actual aggregation result', async () => {
    const { client, getIntradayChart } = mockedClient({
      meta: {
        dataGranularity: '15m',
        exchangeTimezoneName: 'America/New_York',
      },
      timestamp: [
        Date.parse('2026-09-16T13:30:00Z') / 1_000,
        Date.parse('2026-09-16T13:45:00Z') / 1_000,
        Date.parse('2026-09-16T14:00:00Z') / 1_000,
      ],
      indicators: {
        quote: [
          {
            high: [12.22222, 14.44444, 99],
            low: [10.11111, 12.33333, 98],
            volume: [100, 0, 500],
          },
        ],
      },
    });

    const response = await requestApp(
      client,
      '/api/stocks/%20tsla%20/intraday',
    );

    expect(getIntradayChart).toHaveBeenCalledWith('TSLA');
    expect(response).toEqual({
      body: [
        {
          day: '2026-09-16',
          highAverage: 13.3333,
          lowAverage: 11.2222,
          volume: 100,
        },
      ],
      status: 200,
    });
  });

  it('rejects invalid input before calling Yahoo', async () => {
    const { client, getIntradayChart } = mockedClient({});

    const response = await requestApp(
      client,
      '/api/stocks/bad%20symbol/intraday',
    );

    expect(getIntradayChart).not.toHaveBeenCalled();
    expect(response).toEqual({
      body: {
        error: {
          code: 'INVALID_SYMBOL_FORMAT',
          message:
            'Symbol must be 1-20 characters using letters, numbers, dot, hyphen, caret, or equals.',
        },
      },
      status: 400,
    });
  });

  it('returns unsupported granularity separately from an invalid symbol', async () => {
    const { client } = mockedClient({
      meta: {
        dataGranularity: '1d',
        exchangeTimezoneName: 'America/New_York',
      },
      timestamp: [],
      indicators: { quote: [{ high: [], low: [], volume: [] }] },
    });

    await expect(
      requestApp(client, '/api/stocks/VTSAX/intraday'),
    ).resolves.toEqual({
      body: {
        error: {
          code: 'INTRADAY_DATA_UNAVAILABLE',
          message:
            'Yahoo did not return 15-minute intraday data for that symbol.',
        },
      },
      status: 422,
    });
  });

  it.each([
    {
      error: new YahooNoDataError(),
      expected: {
        body: {
          error: {
            code: 'SYMBOL_NOT_FOUND_OR_NO_DATA',
            message: 'No intraday data was found for that symbol.',
          },
        },
        status: 404,
      },
      label: 'unknown or no-data symbol',
    },
    {
      error: new YahooMalformedResponseError(),
      expected: {
        body: {
          error: {
            code: 'UPSTREAM_MALFORMED_RESPONSE',
            message: 'Yahoo returned an unexpected market-data response.',
          },
        },
        status: 502,
      },
      label: 'malformed Yahoo response',
    },
    {
      error: new YahooRateLimitError(),
      expected: {
        body: {
          error: {
            code: 'UPSTREAM_RATE_LIMITED',
            message:
              'Yahoo is rate limiting market-data requests. Try again later.',
          },
        },
        status: 503,
      },
      label: 'Yahoo rate limit',
    },
    {
      error: new YahooNetworkError(),
      expected: {
        body: {
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Yahoo market data is currently unavailable.',
          },
        },
        status: 502,
      },
      label: 'network failure',
    },
    {
      error: new YahooUpstreamError(500),
      expected: {
        body: {
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Yahoo market data is currently unavailable.',
          },
        },
        status: 502,
      },
      label: 'Yahoo server failure',
    },
    {
      error: new YahooTimeoutError(),
      expected: {
        body: {
          error: {
            code: 'UPSTREAM_TIMEOUT',
            message: 'The Yahoo market-data request timed out.',
          },
        },
        status: 504,
      },
      label: 'Yahoo timeout',
    },
  ])('maps $label to a consistent JSON error', async ({ error, expected }) => {
    const client: YahooClient = {
      getIntradayChart: vi.fn().mockRejectedValue(error),
    };

    await expect(
      requestApp(client, '/api/stocks/TSLA/intraday'),
    ).resolves.toEqual(expected);
  });

  it('maps structurally invalid chart data to a malformed upstream response', async () => {
    const { client } = mockedClient({
      meta: {
        dataGranularity: '15m',
        exchangeTimezoneName: 'America/New_York',
      },
      timestamp: [Date.parse('2026-09-16T13:30:00Z') / 1_000],
      indicators: { quote: [{ high: [], low: [10], volume: [100] }] },
    });

    await expect(
      requestApp(client, '/api/stocks/TSLA/intraday'),
    ).resolves.toEqual({
      body: {
        error: {
          code: 'UPSTREAM_MALFORMED_RESPONSE',
          message: 'Yahoo returned an unexpected market-data response.',
        },
      },
      status: 502,
    });
  });
});
