import { type FormEvent, useEffect, useRef, useState } from 'react';

interface DailySummary {
  readonly day: string;
  readonly highAverage: number;
  readonly lowAverage: number;
  readonly volume: number;
}

type SearchState =
  | { readonly status: 'initial' }
  | { readonly status: 'loading'; readonly symbol: string }
  | {
      readonly rows: readonly DailySummary[];
      readonly status: 'success';
      readonly symbol: string;
    }
  | { readonly status: 'empty'; readonly symbol: string }
  | {
      readonly message: string;
      readonly status: 'error';
      readonly symbol: string;
    };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const volumeFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDailySummary(value: unknown): value is DailySummary {
  return (
    isRecord(value) &&
    typeof value.day === 'string' &&
    DAY_PATTERN.test(value.day) &&
    typeof value.lowAverage === 'number' &&
    Number.isFinite(value.lowAverage) &&
    typeof value.highAverage === 'number' &&
    Number.isFinite(value.highAverage) &&
    typeof value.volume === 'number' &&
    Number.isSafeInteger(value.volume)
  );
}

function isDailySummaryArray(value: unknown): value is DailySummary[] {
  return Array.isArray(value) && value.every(isDailySummary);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string' &&
      payload.error.message.trim() !== ''
    ) {
      return payload.error.message;
    }
  } catch {
    // The status fallback below also covers an unreadable error body.
  }

  return `The request failed with status ${response.status}. Please try again.`;
}

function ResultsTable({
  rows,
  symbol,
}: {
  readonly rows: readonly DailySummary[];
  readonly symbol: string;
}) {
  return (
    <div className="table-scroll" tabIndex={0}>
      <table>
        <caption>Daily intraday summaries for {symbol}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" className="numeric">
              Low average
            </th>
            <th scope="col" className="numeric">
              High average
            </th>
            <th scope="col" className="numeric">
              Volume
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <th scope="row">
                <time dateTime={row.day}>{row.day}</time>
              </th>
              <td className="numeric average">{row.lowAverage.toFixed(4)}</td>
              <td className="numeric average">{row.highAverage.toFixed(4)}</td>
              <td className="numeric volume">
                {volumeFormatter.format(row.volume)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatePanel({
  onRetry,
  state,
}: {
  readonly onRetry: (symbol: string) => void;
  readonly state: SearchState;
}) {
  if (state.status === 'initial') {
    return (
      <section
        className="state-panel initial-state"
        aria-labelledby="start-title"
      >
        <div className="state-icon" aria-hidden="true">
          +
        </div>
        <div>
          <h2 id="start-title">Start with a market symbol</h2>
          <p>
            Enter a symbol above to review up to one month of daily intraday
            summaries.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === 'loading') {
    return (
      <section
        className="state-panel loading-state"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2>Loading {state.symbol}</h2>
          <p>Requesting available intraday summaries...</p>
        </div>
      </section>
    );
  }

  if (state.status === 'empty') {
    return (
      <section className="state-panel" aria-labelledby="empty-title">
        <div className="state-icon muted" aria-hidden="true">
          -
        </div>
        <div>
          <p className="result-label">Results for {state.symbol}</p>
          <h2 id="empty-title">No summaries found</h2>
          <p>The backend returned no usable daily records for this symbol.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onRetry(state.symbol)}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="state-panel error-state" role="alert">
        <div className="state-icon error-icon" aria-hidden="true">
          !
        </div>
        <div>
          <p className="result-label">Search failed for {state.symbol}</p>
          <h2>We couldn't load these summaries</h2>
          <p>{state.message}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onRetry(state.symbol)}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="results-heading">
        <div>
          <p className="result-label">Daily summaries</p>
          <h2 id="results-title">
            Results for <span>{state.symbol}</span>
          </h2>
        </div>
        <p className="record-count">
          {state.rows.length} {state.rows.length === 1 ? 'day' : 'days'}
        </p>
      </div>
      <ResultsTable rows={state.rows} symbol={state.symbol} />
    </section>
  );
}

export function App() {
  const [symbolInput, setSymbolInput] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'initial' });
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  async function search(symbol: string): Promise<void> {
    const normalizedSymbol = symbol.trim().toUpperCase();

    if (normalizedSymbol === '') {
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ status: 'loading', symbol: normalizedSymbol });

    try {
      const response = await fetch(
        `/api/stocks/${encodeURIComponent(normalizedSymbol)}/intraday`,
        { signal: controller.signal },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload: unknown = await response.json();

      if (!isDailySummaryArray(payload)) {
        throw new Error('The backend returned an unexpected response.');
      }

      if (controller.signal.aborted) {
        return;
      }

      setState(
        payload.length === 0
          ? { status: 'empty', symbol: normalizedSymbol }
          : { rows: payload, status: 'success', symbol: normalizedSymbol },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setState({
        message:
          error instanceof Error
            ? error.message
            : 'The summaries could not be loaded. Please try again.',
        status: 'error',
        symbol: normalizedSymbol,
      });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void search(symbolInput);
  }

  return (
    <main className="app-shell">
      <div className="dashboard">
        <header className="hero" aria-labelledby="page-title">
          <div className="brand-mark" aria-hidden="true">
            IM
          </div>
          <div className="hero-copy">
            <p className="eyebrow">Market data explorer</p>
            <h1 id="page-title">Intraday Market Dashboard</h1>
            <p className="summary">
              Search a market symbol to compare daily lows, highs, and trading
              volume from available 15-minute bars.
            </p>
          </div>
        </header>

        <section className="search-card" aria-labelledby="search-title">
          <div className="search-copy">
            <p className="section-kicker">Symbol lookup</p>
            <h2 id="search-title">Find intraday summaries</h2>
          </div>
          <form
            className="search-form"
            role="search"
            aria-label="Stock lookup"
            onSubmit={handleSubmit}
          >
            <label htmlFor="symbol">Market symbol</label>
            <div className="search-controls">
              <input
                id="symbol"
                name="symbol"
                type="text"
                value={symbolInput}
                maxLength={20}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="symbol-hint"
                placeholder="e.g. TSLA"
                onChange={(event) => setSymbolInput(event.target.value)}
              />
              <button type="submit" disabled={symbolInput.trim() === ''}>
                Search
                <span aria-hidden="true">-&gt;</span>
              </button>
            </div>
            <p id="symbol-hint" className="input-hint">
              Enter a Yahoo-supported market symbol. Currency is not assumed.
            </p>
          </form>
        </section>

        <StatePanel state={state} onRetry={(symbol) => void search(symbol)} />

        <footer className="disclosure">
          <span aria-hidden="true">i</span>
          <p>
            Values summarize the available intraday bars returned by the
            backend. The first and latest dates may represent partial trading
            days.
          </p>
        </footer>
      </div>
    </main>
  );
}
