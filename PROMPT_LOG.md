# AI Prompt Log

This log records the prompts used for the assessment, why each prompt was used,
and how the resulting guidance was handled. It should be updated throughout the
exercise rather than reconstructed at the end.

## Manual changes outside AI

No manual file changes outside the documented AI-assisted workflow were
reported during this exercise. Environment-level permission approvals and
interactive browser inspection did not change application files outside the
changes described in the entries below.

## Entry 1: Requirements and repository assessment

### Prompt

```text
I am currently building this take-home assignment in pieces (incremental) to ensure that I have a good understanding of each part, and I can explain/determine my choices for the final implementation.
Read all parts of the assignment and check out the current repository with all related AGENTS.md directions. Do not make any changes to any file, install any packages/dependencies, or implement any items until I say so.
If you are unable to access the PDF or repository, please let me know what is missing instead of making a guess.
Please do the following:
1. Define the requirements/deliverables as testable acceptance criteria.
2. Determine what is already implemented in the repository and identify what is still missing.
3. Identify any ambiguous statements such as "last month", "trading-day" timezone, "daily low/high average", "missing data", "total volume", and "four decimal places."
Separate stated explicit requirements from assumed requirements.
4. Create a basic implementation plan using Node.js/TypeScript and React. Describe major trade-offs without overly engineering everything.
5. Only ask the questions we need to answer prior to implementing.
Please keep this based on requirements/planning. I would like to go through your results before we start writing code.
```

### Why this prompt was used

The goal was to understand the complete assignment, inspect the starting state,
separate explicit requirements from assumptions, and avoid prematurely writing
code before the data contract was understood.

### What was kept, changed, or rejected

- Kept the recommendation to use a small Node.js/TypeScript API and React/Vite
  frontend.
- Kept exchange-local date grouping, ascending output, numeric averages rounded
  to four decimals, and explicit error states as decisions requiring a contract.
- Kept the recommendation to isolate data acquisition and aggregation for
  testing.
- Deferred the suggested implementation until Yahoo's live response behavior
  could be inspected.
- Rejected adding databases, authentication, deployment orchestration, or other
  infrastructure not required by the assessment.

## Entry 2: Read-only Yahoo response investigation

### Prompt

```text
Before we start writing code, let's do some read-only calls to the Yahoo endpoint with both correct and incorrect symbol inputs. We will test:
* Are there actual values for each bar within the 1 month range and 15 minute intervals for session hours?
* What time zones does the data use? Is it timestamped correctly? Is the data array properly aligned? Do you have any N/A (missing) values?
Are incomplete bars (i.e., if Yahoo didn't get all of yesterday afternoon's minutes), or separate latest price observations present, and what would be the best way to deal with them?
What is your missing value strategy? Will this affect averages and volume, but can it be treated as "zero" for volume, or will partial totals be shown as complete?
Can you identify when an input symbol is bad, vs. when there are valid symbols with no data available, vs. when there were errors upstream?
Do you recommend a simple data format/contract? Identify any other decisions left open. Make a distinction between things you've confirmed happen vs. things you're still assuming will work. If you cannot reach the service due to blockages, simply state so without attempting to bypass the blockage or switch services. Make no changes to existing files or install any additional tools yet.
```

### Why this prompt was used

The goal was to replace assumptions about Yahoo's undocumented chart response
with direct observations before defining filtering, aggregation, timezone, and
error behavior.

### What was kept, changed, or rejected

- Confirmed that liquid U.S. equities returned aligned 15-minute timestamp and
  OHLCV arrays for the sample.
- Confirmed that null rows occur for thinly traded instruments and scheduled
  exchange breaks.
- Confirmed that Yahoo can append latest-price observations that resemble bars
  but are off-grid or occur at the session boundary.
- Confirmed that Unix timestamps must be converted with
  `exchangeTimezoneName`.
- Confirmed that invalid and delisted symbols can produce the same Yahoo 404,
  so the application must not claim it can distinguish them.
- Confirmed that a valid mutual fund could return daily data even though `15m`
  was requested.
- Confirmed that summing Yahoo's 15-minute volume did not reproduce its separate
  daily-volume series. The cause was not established and no unsupported cause
  was adopted as fact.
- Rejected treating null volume as an observed zero.
- Rejected discarding a row solely because volume equals zero.
- Rejected hard-coded U.S. session hours as a cross-exchange solution.

## Entry 3: Foundation implementation and agreed data decisions

### Prompt

```text
Now let's go ahead and implement all of the exchange-local date settings along with ascending order for result sets, four-decimal precision for numeric averages, and a total volume calculation defined by the sum of each intraday volume (i.e., the total volume is calculated as the sum of each intraday volume). Do not filter out rows that are missing some of the necessary metrics (e.g., in this case, we will skip any rows that have empty values for the required metrics), but do keep any valid rows where the volume is equal to 0. Additionally, please note that since the code will likely only read totals until it reaches a row where there are no more records left to process, then those totals could potentially be less than complete (as they would only reflect what was processed up to that point).
We will obtain historical data from Yahoo using their range=1mo API call with interval=15m (which means we will get 60 minutes worth of data per hour) and we'll also utilize Yahoo’s regular-session data. We won't automatically exclude the first day or the current day, nor will we exclude any completed bars; we will however document that if today's bar isn't completely filled when the application starts running, then the data displayed will be less than full for that particular day.
In addition to these requirements, we should document that we don't want to automatically restrict access based on trading period just because Yahoo doesn't support the requested level of granularity. Finally, prior to filtering any data, please provide us with a brief explanation of how you plan on identifying "normal" bars versus the additional price observation entries that were identified and how you will know whether you're looking at the correct time frame (session boundary-wise) regardless of which exchange you're accessing. Please also document the first timestamp and the last timestamp from your one month sample of data.
Next, create a simple TypeScript/Express backend and a simple React/Vite frontend. The two applications should be created with very few dependencies, strict type checking enabled, test tools included, and a number of different configurations set up to enforce proper formatting of the code. In addition, set up scripts to enable local development and deployment. Include a simple health check endpoint and a simple frontend shell.
Lastly, create README.md and PROMPT_LOG.md files that describe our actual prompts and decisions. After creating those files, run all available checks and log the results. Stop here before implementing the stock feature. At this point we shouldn't need to make any changes in Git.
```

### Why this prompt was used

The goal was to lock in the data semantics discovered during investigation while
building only a tested, maintainable project foundation. Keeping the stock
feature out of this increment makes the architectural and tooling decisions easy
to review independently.

### What was kept, changed, or rejected

- Kept all explicitly selected aggregation and date semantics as documented
  future behavior.
- Kept `range=1mo`, `interval=15m`, regular-session data, the first and current
  days, valid completed bars, and valid zero-volume rows.
- Interpreted "skip any rows that have empty values" as excluding those rows
  from aggregation while retaining the surrounding day and other valid rows.
- Documented partial-day and partial-total behavior instead of presenting these
  values as guaranteed complete daily market totals.
- Documented a composite price-observation classification rather than filtering
  every zero-volume row.
- Added only the Express health endpoint and React shell. Yahoo access and stock
  aggregation remain intentionally unimplemented.
- No Git commits, branches, resets, or other Git-state mutations were performed.

### Verification results

Verification was run on September 16, 2026 with Node.js `v24.13.0` and npm
`11.6.2`.

`npm run check` completed successfully:

- Prettier: all matched files use the configured style
- ESLint: passed with zero warnings allowed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 1 test passed
- client tests: 1 test passed
- server production build: passed
- client production build: passed with Vite `v8.3.0`

The dependency installation audit reported zero known vulnerabilities. The
existing user-level npm cache contained root-owned files, so installation used
an isolated cache under `/tmp` rather than modifying permissions or changing
the user's global npm configuration.

## Entry 4: Pure validation and daily aggregation

### Prompt

```text
Implement your daily aggregation and pure data validation in this order, no front-end code changes and no HTTP requests.
Summarize the documented bar filtering rules. Identify which of these were an assumption based on the sample Yahoo data provided. Filter by session date (i.e., do not use today's date).
Follow the contract we have previously agreed upon:
exchange local dates
completed 15 minute bars
arithmetic average of the lowest and highest prices
sum of usable volume
ascending dates
rounding only occurs after averaging
skip rows with missing fields
preserve valid zero volume bars
retain partial day data
add deterministic tests for:
a hand calculated example
local dates and daylight savings time (DST)
missing values, zero volume, and empty results
arrays that are misaligned and/or cannot be supported at the desired granularity
uncompleted bars and/or additional price observations
timestamps that are unsorted or contain duplicates
four decimal place rounding
pass the current time as a parameter where necessary to ensure test reproducibility.
explain the difference between malformed input and rows that can be skipped.
run npm run check. provide a truthful prompt log. display the hand-calculated example along with the actual output. Do not commit or push until you complete step #4.
```

### Why this prompt was used

The goal was to implement and test the deterministic transformation boundary
before adding Yahoo networking or an HTTP stock endpoint. It also explicitly
changed the earlier decision about the current day: current exchange-local dates
are now excluded.

### What was kept, changed, or rejected

- Implemented a pure `aggregateDailyData` function with no network or framework
  dependency.
- Implemented strict response-shape, timezone, granularity, array-alignment, and
  timestamp validation.
- Kept exchange-local grouping, completed 15-minute grid-aligned rows, ascending
  output, post-average four-decimal rounding, usable volume summation, valid zero
  volume, and partial historical days.
- Changed the earlier current-day behavior: all rows from the exchange-local
  current date are now excluded.
- Chose to reject unsorted or duplicate timestamps instead of silently sorting
  or double-counting questionable upstream data.
- Chose to skip row-level missing values while rejecting response-level shape
  problems that make positional alignment unsafe.
- Documented that off-grid latest-price classification and current-date removal
  of the sampled closing observation are sample-based assumptions.
- Did not add a Yahoo client, make an HTTP request, change frontend source, or
  create an Express stock route.
- Reworked the existing health check test to call its handler directly because
  this increment prohibited HTTP requests; endpoint behavior remains unchanged.
- No commit or push was performed.

### Verification results

`npm run check` completed successfully on September 16, 2026:

- Prettier formatting check: passed
- ESLint with zero warnings allowed: passed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 11 passed across 2 files
- client tests: 1 passed across 1 file
- server production build: passed
- client Vite production build: passed

The command executed without Yahoo calls or any other HTTP request. The new
aggregation tests use only deterministic in-memory fixtures and explicitly
supplied current times.

## Entry 5: Correct current-day and latest-observation filtering

### Prompt

```text
Before you integrate the API, correct the contract discrepancy: we will retain partial days that include all of today's bars and remove the current local-date/blanket exclusion for the current exchange/local date.
Filter in separate observations. Use session metadata only to define the dates that it covers – do not use current session bounds on historical days. Do not eliminate legitimate zero-volume bars.
If an observation cannot be reliably categorized as either trading or non-trading, describe why instead of eliminating the trade agreement.
Include regression testing that demonstrates that:
today’s completed bars are included;
an unfinished bar is excluded;
a bar completes at the exact moment provided as today’s current time, therefore, it is included;
entries for closing/latest prices are excluded if they have supporting metadata;
all legitimate zero-volume bars and historical partial days are retained and included;
show me your filter code and related test-cases so i may view them. Run npm run check and then add to README.md and PROMPT_LOG.md to document this fix without modifying prior history.
```

### Why this prompt was used

The goal was to correct the blanket current-date exclusion before connecting the
pure transformation to an API. The revised contract keeps completed current-day
bars and removes only observations that can be identified conservatively with
Yahoo's current-session metadata.

### What was kept, changed, or rejected

- Removed the exchange-local current-date exclusion.
- Included a bar when its completion time exactly equals the supplied current
  time; bars completing later remain excluded.
- Added optional validation of aligned `open` and `close` arrays so a separate
  price observation can be recognized without changing the required aggregation
  metrics.
- Excluded a latest observation only when OHLC, zero volume, price metadata,
  timestamp metadata, and the metadata-covered session date agree.
- Limited `currentTradingPeriod.regular` evidence to the exchange-local date or
  dates covered by that exact epoch interval. It is not reused as a historical
  daily schedule.
- Retained zero-volume bars, historical partial days, current partial days, and
  ambiguous off-grid observations without adequate classification metadata.
- Preserved the prior prompt entries unchanged so the decision correction is
  visible in sequence.
- Made no frontend changes, Yahoo requests, commits, or pushes.

### Verification results

`npm run check` completed successfully on September 16, 2026:

- Prettier formatting check: passed
- ESLint with zero warnings allowed: passed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 15 passed across 2 files
- client tests: 1 passed across 1 file
- server production build: passed
- client Vite production build: passed

## Entry 6: Yahoo client and intraday endpoint

### Prompt

```text
Implement the Yahoo client and GET /api/stocks/:symbol/intraday endpoint using the existing aggregation logic. Preserve the agreed contract and document the observation filter as a heuristic, not guaranteed classification.
Validate and normalize symbols, safely encode them against a fixed Yahoo host, and request range=1mo, interval=15m, includePrePost=false with the required User-Agent. Add a timeout covering both fetching and reading the response.
Return the required array on success and consistent JSON errors for invalid input, unknown/no-data symbols, unsupported granularity, malformed upstream responses, rate limits, network failures, and timeouts. Don’t classify every null result as an invalid symbol; inspect Yahoo’s error information.
Add mocked integration tests covering these paths, request parameters, and the actual aggregation result. Keep automated tests independent of live Yahoo access; never substitute fake data in production.
Run npm run check, update README.md and the prompt log, and show one successful and one error response. Clearly label mocked versus live results. Stop before frontend changes; don’t commit or push.
```

### Why this prompt was used

The goal was to connect the tested, pure aggregation boundary to a narrowly
scoped Yahoo transport and Express route while retaining deterministic tests and
the previously agreed data semantics.

### What was kept, changed, or rejected

- Added a Yahoo client restricted to the fixed chart host and required
  `range=1mo`, `interval=15m`, and `includePrePost=false` parameters.
- Added symbol trimming, uppercase normalization, conservative validation, and
  path-segment encoding before any Yahoo request.
- Kept one timeout active through both the fetch and response-body read.
- Added `GET /api/stocks/:symbol/intraday`, which delegates successful chart
  results to the existing pure aggregator.
- Added stable JSON error codes for local validation, explicit Yahoo no-data
  errors, unsupported granularity, malformed responses, rate limiting, network
  or upstream failures, and timeouts.
- Inspected Yahoo's structured error before assigning the combined
  unknown/no-data classification. A null result without supporting error
  information is classified as malformed upstream data.
- Documented the latest/closing observation filter as a conservative heuristic,
  not a guaranteed classification. Ambiguous observations remain eligible.
- Used injected fetch and Yahoo-client doubles plus a loopback Express server in
  tests. No test contacted live Yahoo, and production code has no fixture-data
  fallback.
- Made no frontend changes and performed no commit or push.

### Verification results

During implementation, the first full check stopped at a formatting mismatch in
one new assertion. After formatting, the next run identified an unnecessary
regular-expression escape. Both issues were corrected.

The subsequent `npm run check` completed successfully on September 16, 2026:

- Prettier formatting check: passed
- ESLint with zero warnings allowed: passed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 31 passed across 4 files
- client tests: 1 passed across 1 file
- server production build: passed
- client Vite production build: passed

All Yahoo-client and route cases used mocks or in-memory fixtures. No live Yahoo
request was made for this implementation increment.

## Entry 7: React stock lookup and results interface

### Prompt

```text
Develop a React-based front-end client against the current back-end endpoint. The current API is to remain unaltered. Include:
* A named symbol input and keyboard-accessible search bar.
* Clearly identifiable initial, loading, success, empty, and error states along with a convenient mechanism to attempt again.
* A responsive, accessible table displaying data in the format of day, low average, high average, and volume.
* Four decimal points exactly for averages and readable integer values for volumes. Display local-exchange date strings without timezone shifts. Do not presume all symbols use USD.
* Clearly identify the submitted symbol whose results are being presented.
* Protect against older requests from over-writing newer requests; cancellation will be considered successful.
* Briefly state in the app that the values provided represent summaries of available intraday bars (which may include partial days).
Only utilize the back-end. No mock data to fall-back on, no chart dependencies, and/or any unused UI libraries.
Run the following npm commands and report any that fail to execute:
* npm run check
* Inspect UI at desktop and mobile width(s) if applicable. Report any issues experienced while executing these commands.
Create updates to README.md and PROMPT_LOG.md documenting actual modifications made and results achieved. Do NOT commit or push until completion.
```

### Why this prompt was used

The goal was to complete the user-facing portion of the assessment against the
existing API while keeping formatting, partial-data disclosure, accessibility,
and overlapping-request behavior explicit and testable.

### What was kept, changed, or rejected

- Replaced the frontend shell with a labeled semantic search form and explicit
  initial, loading, success, empty, and error states.
- Used only the existing relative `/api/stocks/:symbol/intraday` backend route.
  The Express route and response contract were not changed.
- Added Vite development and preview proxies for the relative `/api` path.
- Added a responsive semantic table. Dates are rendered from the returned
  `YYYY-MM-DD` strings without `Date` conversion, averages use `toFixed(4)`, and
  volume uses integer grouping without currency notation.
- Displayed the normalized submitted symbol in loading, success, empty, and
  error views rather than relying on the possibly edited input value.
- Used `AbortController` to cancel an earlier request on every new search and
  guarded state updates after cancellation.
- Added response-shape validation, backend error-message handling, retry actions,
  and a partial-day disclosure. No runtime fixture or mock fallback was added.
- Added deterministic frontend tests for every state, exact formatting, retry,
  request arguments, and an older-request/newer-request race.
- Added the missing `tsx` development dependency because the existing server
  `dev` script already invoked it. No frontend UI library or chart dependency
  was added.
- Made no commit or push.

### Verification results

The first `npm run check` attempt reached the server integration tests but the
execution sandbox rejected their loopback listener with `listen EPERM`. Client
tests passed in that run. After loopback network access was enabled, the same
command completed successfully on September 17, 2026:

- Prettier formatting check: passed
- ESLint with zero warnings allowed: passed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 31 passed across 4 files
- client tests: 5 passed across 1 file
- server production build: passed
- client Vite production build: passed

The first `npm run dev` attempt failed because `tsx` was referenced but not
installed. The first installation attempt then hit the existing root-owned npm
cache problem. Installation succeeded with an isolated cache under
`/private/tmp`, reported zero vulnerabilities, and the combined API and Vite
development command then started successfully.

The first browser connection to `127.0.0.1` was refused because Vite's default
listener resolved only on `localhost` in this environment. The Vite development
host was set explicitly to `127.0.0.1`, the process was restarted, and browser
inspection then connected successfully.

Browser inspection covered a 1080 by 900 desktop viewport and a 390 by 844
mobile viewport. A keyboard-submitted live `TSLA` request traveled through the
backend and rendered 23 daily rows. A backend-rejected `BAD SYMBOL` request
displayed its error and retry action. At mobile width, the 640-pixel semantic
table occupied a 359-pixel keyboard-focusable horizontal scrolling region. No
page-level horizontal overflow, clipped controls, browser console warnings, or
browser console errors were observed. The table requires horizontal scrolling
on mobile by design so all four columns retain readable headings and values.

## Entry 8: Final assessment audit and local commit

### Prompt

```text
Complete this project in line with all of the assessment's stated specifications. Do not add any additional functionality (features), infrastructure or complex processes.
Compare what we currently have for the app to the assessment requirements and only fix concrete bugs/requirements that are missing from the app. Make sure both the README file has working install/run commands and that PROMPT_LOG.md is capturing all our prompts, decisions and any manual updates made.
Run npm run check. Compare the files to be staged which exclude secrets, dependancies, build output and other unrelated files. Once checks pass create a local commit based on the configured git identity:
feat: implement full-stack intraday market dashboard
Provide the commit hash and results of your verification as well as any remaining gaps in your requirements. Do not push yet.
```

### Why this prompt was used

The goal was to perform a final requirement-by-requirement audit against the
assessment PDF, correct only concrete completion gaps, verify the repository
contents, and create the requested local handoff commit.

### What was kept, changed, or rejected

- Confirmed that the Node.js/TypeScript API, last-month Yahoo request, daily
  grouping, required response fields, React symbol lookup, result table, and
  error handling satisfy the stated functional requirements.
- Aligned the aggregate object's field insertion order with the assessment's
  example: `day`, `lowAverage`, `highAverage`, then `volume`.
- Made the README's development and production-preview addresses and terminal
  instructions match the Vite configuration.
- Added an explicit manual-changes section to this log. No manual file changes
  outside the documented AI-assisted workflow were reported.
- Kept the existing focused validation, tests, formatting, and accessibility
  work because they support production quality without adding product scope.
- Rejected additional features, deployment infrastructure, data stores, chart
  libraries, CI workflows, and other processes not required by the assessment.
- Planned staging excludes ignored dependencies, build outputs, TypeScript
  build metadata, environment files, logs, and OS metadata.
- No push was performed.

### Verification results

`npm run check` completed successfully on September 17, 2026:

- Prettier formatting check: passed
- ESLint with zero warnings allowed: passed
- server strict TypeScript check: passed
- client strict TypeScript check: passed
- server tests: 31 passed across 4 files
- client tests: 5 passed across 1 file
- server production build: passed
- client Vite production build: passed

The documented setup and local run path was also checked. `npm install
--dry-run` reported the workspace lockfile up to date. `npm run dev` started the
API at port 3000 and Vite at `http://127.0.0.1:5173`; direct health and frontend
requests succeeded, and an invalid-symbol request through Vite's `/api` proxy
returned the expected structured HTTP 400 response.
