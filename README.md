# Intraday Market Dashboard

A deliberately incremental Node.js/TypeScript and React implementation of the
intraday market-data take-home assessment.

## Current scope

The repository currently contains:

- an Express API with `GET /health` and
  `GET /api/stocks/:symbol/intraday`
- a responsive React/Vite stock lookup and results interface
- strict TypeScript configuration
- ESLint, Prettier, and EditorConfig formatting rules
- a pure Yahoo chart-result validator and daily aggregation function
- a Yahoo chart client with validated symbol handling and bounded requests
- deterministic Vitest coverage for the health endpoint, Yahoo client, stock
  endpoint, aggregation, frontend states, formatting, retry, and request races
- local development, build, test, and preview scripts

The frontend uses only the Express endpoint documented below. It contains no
mock-data fallback, chart package, currency assumption, or unused UI library.

## Prerequisites

- Node.js 20.19 or newer
- npm 10 or newer

The repository includes an `.nvmrc` file for users of `nvm`.

## Install

From the repository root:

```sh
npm install
```

## Local development

Start the API and frontend together:

```sh
npm run dev
```

- API: `http://localhost:3000`
- Frontend: `http://127.0.0.1:5173`
- Health check: `http://localhost:3000/health`
- Intraday API example: `http://localhost:3000/api/stocks/TSLA/intraday`

The health endpoint returns:

```json
{
  "status": "ok"
}
```

The applications can also be run independently:

```sh
npm run dev --workspace @intraday-market-dashboard/server
npm run dev --workspace @intraday-market-dashboard/client
```

Set `PORT` to change the API port.

During Vite development and preview, `/api` requests are proxied to
`http://localhost:3000`. A production frontend host must forward the same
same-origin `/api` path to the Express application.

## Checks

Run every required check:

```sh
npm run check
```

Individual commands are also available:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Apply the configured formatter with:

```sh
npm run format
```

## Build and deployment scripts

Build both applications:

```sh
npm run build
```

Start the compiled API:

```sh
npm start
```

Preview the production frontend build:

```sh
npm run preview
```

Run those two commands in separate terminals after `npm run build`. The preview
is available at `http://127.0.0.1:4173` and proxies `/api` to the compiled API
at port 3000.

The frontend build is written to `client/dist`, which can be deployed to a
static host. The API build is written to `server/dist` and is started with
Node.js. The production host or reverse proxy must route `/api` to Express;
combining the applications into one deployment unit remains intentionally
deferred.

## Yahoo request

The server requests Yahoo's chart endpoint only at the fixed
`https://query1.finance.yahoo.com` host with:

- `range=1mo`
- `interval=15m`, giving four possible 15-minute records per continuous hour
- `includePrePost=false` for regular-session data
- a browser-style `User-Agent` header required by the upstream request

We will not preemptively block an instrument or exchange based on its trading
period. We also do not label a symbol invalid merely because Yahoo responds at
a different granularity. The implementation inspects the actual response and
distinguishes unsupported/unavailable intraday data from invalid input and
upstream failures.

Symbols are trimmed, normalized to uppercase, checked against a conservative
1-20 character allowlist, and percent-encoded only as a path segment. User input
cannot select the host or supply query parameters. A 10-second timeout remains
active for both fetching the response and reading its body.

Yahoo's structured error information is inspected before classifying an unknown
or no-data symbol. A null `chart.result` without supporting no-data error
information is treated as a malformed upstream response, not automatically as
an invalid symbol. Production code never substitutes fixture or synthetic data
when Yahoo fails.

## Stock endpoint

```text
GET /api/stocks/:symbol/intraday
```

Successful requests return the daily aggregation array documented below. Errors
use one consistent envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation."
  }
}
```

| Status | Code                          | Meaning                                             |
| -----: | ----------------------------- | --------------------------------------------------- |
|    400 | `INVALID_SYMBOL_FORMAT`       | The path symbol fails local validation.             |
|    404 | `SYMBOL_NOT_FOUND_OR_NO_DATA` | Yahoo explicitly reports unknown or no usable data. |
|    422 | `INTRADAY_DATA_UNAVAILABLE`   | Yahoo returned an unsupported granularity.          |
|    502 | `UPSTREAM_MALFORMED_RESPONSE` | Yahoo's response cannot be safely interpreted.      |
|    502 | `UPSTREAM_UNAVAILABLE`        | A network or other Yahoo upstream failure occurred. |
|    503 | `UPSTREAM_RATE_LIMITED`       | Yahoo returned a rate limit.                        |
|    504 | `UPSTREAM_TIMEOUT`            | Fetching or reading exceeded the timeout.           |

### Mocked response examples

These examples come from deterministic route tests with a mocked Yahoo client;
they are **not live Yahoo results**.

Mocked successful response (`200`):

```json
[
  {
    "day": "2026-09-16",
    "lowAverage": 11.2222,
    "highAverage": 13.3333,
    "volume": 100
  }
]
```

Mocked unknown/no-data response (`404`):

```json
{
  "error": {
    "code": "SYMBOL_NOT_FOUND_OR_NO_DATA",
    "message": "No intraday data was found for that symbol."
  }
}
```

## Frontend behavior

The React client calls only the relative backend route
`/api/stocks/:symbol/intraday`. Its behavior is intentionally small and
explicit:

- A labeled `symbol` input and semantic search form support pointer and keyboard
  submission. Input is trimmed and normalized to uppercase for the request and
  result heading.
- Separate initial, loading, success, empty, and error views make request state
  visible. Empty and error views include a retry button for the submitted
  symbol.
- Starting a search aborts the previous request. An aborted request is also
  prevented from updating state if its promise settles later.
- Successful data is validated before rendering. Unexpected backend payloads
  are shown as errors rather than replaced with synthetic data.
- The submitted symbol is shown above an accessible table with day, low average,
  high average, and volume columns.
- Average values use exactly four decimal places. Volumes use locale-aware
  integer grouping without a currency label.
- Exchange-local `YYYY-MM-DD` strings are rendered directly and are never
  parsed into browser-local dates, avoiding timezone shifts.
- On narrow screens, the complete semantic table remains available in a
  keyboard-focusable horizontal scrolling region.
- The interface states that results summarize available intraday bars and can
  include partial days.

## Daily aggregation contract

`server/src/market-data/aggregateDailyData.ts` accepts one Yahoo chart result and
an explicit current time. Passing the clock as data keeps date filtering and bar
completion tests deterministic. It returns records in ascending exchange-local
date order:

```json
[
  {
    "day": "2026-09-15",
    "lowAverage": 40.2958,
    "highAverage": 49.7534,
    "volume": 49073348
  }
]
```

The agreed semantics are:

- Convert each Unix timestamp into a calendar day using Yahoo's
  `exchangeTimezoneName` IANA timezone. Do not use the server's timezone or a
  fixed UTC offset.
- Sort daily records by `day` in ascending order.
- Calculate `lowAverage` and `highAverage` from the accepted intraday rows and
  round the numeric results to four decimal places only after averaging.
- Calculate `volume` as the sum of each accepted intraday row's volume.
- Skip a row when any required aggregation value is empty, null, non-numeric,
  or non-finite.
- Keep valid rows whose reported volume is exactly zero.
- Retain partial historical and current exchange-local days when they have at
  least one usable completed row.
- Include a bar when `bar timestamp + 15 minutes` is exactly equal to the
  explicitly supplied current time.
- Exclude a still-forming bar whose completion time is later than the supplied
  current time.
- Retain every otherwise valid completed bar, including today's bars.

The result reflects only the usable rows Yahoo returned and the application
processed. A day's volume can therefore be less than an authoritative full-day
total. The initial and current days can be partial because `range=1mo` is a
rolling window and the current session may still be active. The UI and
documentation must not imply otherwise.

This corrects the earlier temporary contract that excluded the entire current
exchange-local date. The current implementation includes all completed usable
bars from today.

## Bar classification

Filtering must occur before daily aggregation. The implementation will not use
zero volume by itself as evidence that a row is invalid.

A normal candidate bar is identified by all of the following:

1. Its timestamp and OHLCV indexes are aligned in Yahoo's arrays.
2. Its epoch timestamp converts through `exchangeTimezoneName`, not a
   hard-coded market timezone.
3. Its 15-minute interval is complete relative to the explicitly supplied
   current time.
4. Its required aggregation values are finite and non-negative.

A separate closing/latest-price observation is excluded only when all available
evidence supports that classification:

- aligned `open`, `low`, `high`, and `close` values all match
  `regularMarketPrice` within a small floating-point tolerance
- its reported volume is zero
- its timestamp either equals `regularMarketTime`, or equals the exact current
  regular-session end after `regularMarketTime` has reached that boundary
- its exchange-local date is one of the dates covered by that specific
  `currentTradingPeriod.regular` interval

The current regular-session bounds are never applied to historical dates. A
valid zero-volume row that does not meet the complete latest-price signature
remains eligible.

The additional-observation filter is explicitly a heuristic based on sampled
Yahoo behavior, not a guaranteed classification. Yahoo does not provide a
formal discriminator in each row. An off-grid or flat zero-volume entry without
the supporting metadata is ambiguous. It is retained rather than silently
discarded because it cannot be reliably categorized as trading or non-trading.

The pure response does not provide a historical session calendar. The
implementation therefore does not hard-code `09:30-16:00` or claim it can detect
an on-grid synthetic observation from an older session. Historical half-days
and upstream-truncated sessions can remain partial.

## Malformed input versus skipped rows

Malformed response-level input makes the complete result unsafe to interpret,
so aggregation throws `MarketDataValidationError`. Examples include a missing
timezone or quote array, array lengths that do not match `timestamp`, invalid
timestamps, unsorted timestamps, and duplicates. A response whose
`dataGranularity` is not `15m` throws the distinct
`UnsupportedGranularityError`; this describes the returned dataset and does not
claim that the requested symbol is invalid.

A skippable row occurs inside an otherwise structurally valid and aligned
response. Rows are skipped when low, high, or volume is missing/non-finite, when
the interval is not complete, or when complete current-session metadata reliably
identifies a separate latest/closing-price observation. Other valid rows and
partial historical or current days remain usable. Numeric zero volume is valid
and is not a missing value.

## Hand-calculated example

For September 14, the deterministic fixture contains:

- lows: `10.12345 + 10.23456 + 10.34567 = 30.70368`;
  `30.70368 / 3 = 10.23456`, rounded after averaging to `10.2346`
- highs: `11.98765 + 12.09876 + 12.20987 = 36.29628`;
  `36.29628 / 3 = 12.09876`, rounded after averaging to `12.0988`
- volume: `100 + 0 + 250 = 350`; the zero-volume bar remains included

The actual function output for that day is:

```json
{
  "day": "2026-09-14",
  "lowAverage": 10.2346,
  "highAverage": 12.0988,
  "volume": 350
}
```

## Recorded one-month sample boundaries

During the read-only `TSLA` investigation on September 16, 2026, Yahoo returned:

- first raw timestamp: `1786973400` = `2026-08-17T13:30:00.000Z` =
  `2026-08-17 09:30:00 America/New_York`
- last raw timestamp: `1789588800` = `2026-09-16T20:00:00.000Z` =
  `2026-09-16 16:00:00 America/New_York`

The final normal 15-minute bar began at 15:45 Eastern. The raw 16:00 entry had
identical OHLC values and zero volume, so it was classified during analysis as
an additional closing-price observation rather than a normal 15-minute bar.

These timestamps describe that observed sample, not a permanent fixture or a
test expectation.

## Project structure

```text
.
|-- client/                 React/Vite lookup and results interface
|-- server/                 Express API, Yahoo client, and market-data logic
|-- eslint.config.js        shared lint rules
|-- tsconfig.base.json      shared strict TypeScript rules
|-- README.md               setup, decisions, and limitations
`-- PROMPT_LOG.md           AI collaboration record
```
