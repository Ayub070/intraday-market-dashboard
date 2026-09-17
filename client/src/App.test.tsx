import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
      status,
    }),
  );
}

function submitSymbol(symbol: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Market symbol' }), {
    target: { value: symbol },
  });
  fireEvent.submit(screen.getByRole('search', { name: 'Stock lookup' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders a named, keyboard-operable search form and initial state', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Intraday Market Dashboard' }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('textbox', { name: 'Market symbol' })
        .getAttribute('name'),
    ).toBe('symbol');
    expect(
      screen.getByRole('heading', { name: 'Start with a market symbol' }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /search/i })).toBeDefined();
    expect(
      screen.getByText(/values summarize the available intraday bars/i),
    ).toBeDefined();
  });

  it('shows loading and renders a successful response with exact formatting', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    submitSymbol(' tsla ');

    expect(screen.getByRole('heading', { name: 'Loading TSLA' })).toBeDefined();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/stocks/TSLA/intraday', {
      signal: expect.any(AbortSignal),
    });

    if (resolveRequest === undefined) {
      throw new Error('Expected the request to be pending.');
    }

    const resolveSuccessfulRequest = resolveRequest;

    await act(async () => {
      resolveSuccessfulRequest(
        new Response(
          JSON.stringify([
            {
              day: '2026-09-16',
              highAverage: 12,
              lowAverage: 10.1,
              volume: 1_234_567,
            },
          ]),
          { status: 200 },
        ),
      );
    });

    expect(
      await screen.findByRole('heading', { name: 'Results for TSLA' }),
    ).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeDefined();
    expect(screen.getByText('2026-09-16').textContent).toBe('2026-09-16');
    expect(screen.getByText('10.1000')).toBeDefined();
    expect(screen.getByText('12.0000')).toBeDefined();
    expect(screen.getByText('1,234,567')).toBeDefined();
  });

  it('shows the empty state and offers a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => jsonResponse([])),
    );
    render(<App />);

    submitSymbol('MSFT');

    expect(
      await screen.findByRole('heading', { name: 'No summaries found' }),
    ).toBeDefined();
    expect(screen.getByText('Results for MSFT')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('shows the backend error and retries the submitted symbol', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() =>
        jsonResponse(
          {
            error: {
              code: 'SYMBOL_NOT_FOUND_OR_NO_DATA',
              message: 'No intraday data was found for that symbol.',
            },
          },
          404,
        ),
      )
      .mockImplementationOnce(() => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    submitSymbol('missing');

    expect(
      await screen.findByRole('heading', {
        name: "We couldn't load these summaries",
      }),
    ).toBeDefined();
    expect(screen.getByText('Search failed for MISSING')).toBeDefined();
    expect(
      screen.getByText('No intraday data was found for that symbol.'),
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'No summaries found' }),
    ).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/stocks/MISSING/intraday', {
      signal: expect.any(AbortSignal),
    });
  });

  it('cancels an older request and prevents it from replacing newer results', async () => {
    const pending: Array<{
      readonly resolve: (response: Response) => void;
      readonly signal: AbortSignal | null;
    }> = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          pending.push({ resolve, signal: init?.signal ?? null });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    submitSymbol('TSLA');
    await waitFor(() => expect(pending).toHaveLength(1));
    submitSymbol('AAPL');
    await waitFor(() => expect(pending).toHaveLength(2));

    const olderRequest = pending[0];
    const newerRequest = pending[1];

    if (olderRequest === undefined || newerRequest === undefined) {
      throw new Error('Expected two pending requests.');
    }

    expect(olderRequest.signal?.aborted).toBe(true);

    await act(async () => {
      newerRequest.resolve(
        new Response(
          JSON.stringify([
            {
              day: '2026-09-17',
              highAverage: 201.25,
              lowAverage: 198.5,
              volume: 900,
            },
          ]),
          { status: 200 },
        ),
      );
    });

    expect(
      await screen.findByRole('heading', { name: 'Results for AAPL' }),
    ).toBeDefined();

    await act(async () => {
      olderRequest.resolve(
        new Response(
          JSON.stringify([
            {
              day: '2026-09-16',
              highAverage: 300,
              lowAverage: 290,
              volume: 100,
            },
          ]),
          { status: 200 },
        ),
      );
    });

    expect(
      screen.getByRole('heading', { name: 'Results for AAPL' }),
    ).toBeDefined();
    expect(
      screen.queryByRole('heading', { name: 'Results for TSLA' }),
    ).toBeNull();
  });
});
