const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60;

type UnknownRecord = Record<string, unknown>;

interface ValidatedChartData {
  readonly closes: readonly unknown[] | undefined;
  readonly exchangeTimezoneName: string;
  readonly highs: readonly unknown[];
  readonly latestObservationMetadata: LatestObservationMetadata | undefined;
  readonly lows: readonly unknown[];
  readonly opens: readonly unknown[] | undefined;
  readonly timestamps: readonly number[];
  readonly volumes: readonly unknown[];
}

interface LatestObservationMetadata {
  readonly regularMarketPrice: number;
  readonly regularMarketTime: number;
  readonly sessionEnd: number;
  readonly sessionStart: number;
}

export interface DailyAggregate {
  readonly day: string;
  readonly lowAverage: number;
  readonly highAverage: number;
  readonly volume: number;
}

export class MarketDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketDataValidationError';
  }
}

export class UnsupportedGranularityError extends Error {
  constructor(granularity: unknown) {
    super(`Expected 15m market data, received ${String(granularity)}.`);
    this.name = 'UnsupportedGranularityError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new MarketDataValidationError(`${path} must be an object.`);
  }

  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new MarketDataValidationError(`${path} must be an array.`);
  }

  return value;
}

function validateTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MarketDataValidationError(
      'meta.exchangeTimezoneName must be a non-empty string.',
    );
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    throw new MarketDataValidationError(
      `meta.exchangeTimezoneName is not a supported IANA timezone: ${value}.`,
    );
  }

  return value;
}

function validateTimestamps(values: readonly unknown[]): readonly number[] {
  const timestamps = values.map((value, index) => {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      !Number.isSafeInteger(value)
    ) {
      throw new MarketDataValidationError(
        `timestamp[${index}] must be an integer Unix timestamp.`,
      );
    }

    return value;
  });

  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const current = timestamps[index];

    if (previous === undefined || current === undefined) {
      throw new MarketDataValidationError('Timestamp validation failed.');
    }

    if (current === previous) {
      throw new MarketDataValidationError(
        `timestamp contains a duplicate value at index ${index}.`,
      );
    }

    if (current < previous) {
      throw new MarketDataValidationError(
        `timestamp must be strictly ascending; index ${index} is out of order.`,
      );
    }
  }

  return timestamps;
}

function optionalAlignedArray(
  value: unknown,
  path: string,
  expectedLength: number,
): readonly unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = requireArray(value, path);

  if (values.length !== expectedLength) {
    throw new MarketDataValidationError(
      `${path} length ${values.length} does not match timestamp length ${expectedLength}.`,
    );
  }

  return values;
}

function getLatestObservationMetadata(
  meta: UnknownRecord,
): LatestObservationMetadata | undefined {
  const currentTradingPeriod = meta.currentTradingPeriod;

  if (!isRecord(currentTradingPeriod)) {
    return undefined;
  }

  const regularSession = currentTradingPeriod.regular;

  if (!isRecord(regularSession)) {
    return undefined;
  }

  const { regularMarketPrice, regularMarketTime } = meta;
  const { end, start } = regularSession;

  if (
    typeof regularMarketPrice !== 'number' ||
    !Number.isFinite(regularMarketPrice) ||
    typeof regularMarketTime !== 'number' ||
    !Number.isSafeInteger(regularMarketTime) ||
    typeof start !== 'number' ||
    !Number.isSafeInteger(start) ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(end) ||
    start >= end
  ) {
    return undefined;
  }

  return {
    regularMarketPrice,
    regularMarketTime,
    sessionEnd: end,
    sessionStart: start,
  };
}

function validateChartData(input: unknown): ValidatedChartData {
  const result = requireRecord(input, 'chart result');
  const meta = requireRecord(result.meta, 'meta');

  if (typeof meta.dataGranularity !== 'string') {
    throw new MarketDataValidationError(
      'meta.dataGranularity must be a string.',
    );
  }

  if (meta.dataGranularity !== '15m') {
    throw new UnsupportedGranularityError(meta.dataGranularity);
  }

  const exchangeTimezoneName = validateTimezone(meta.exchangeTimezoneName);
  const timestamps = validateTimestamps(
    requireArray(result.timestamp, 'timestamp'),
  );
  const indicators = requireRecord(result.indicators, 'indicators');
  const quotes = requireArray(indicators.quote, 'indicators.quote');
  const quote = requireRecord(quotes[0], 'indicators.quote[0]');
  const lows = requireArray(quote.low, 'indicators.quote[0].low');
  const highs = requireArray(quote.high, 'indicators.quote[0].high');
  const volumes = requireArray(quote.volume, 'indicators.quote[0].volume');
  const opens = optionalAlignedArray(
    quote.open,
    'indicators.quote[0].open',
    timestamps.length,
  );
  const closes = optionalAlignedArray(
    quote.close,
    'indicators.quote[0].close',
    timestamps.length,
  );

  for (const [path, values] of [
    ['low', lows],
    ['high', highs],
    ['volume', volumes],
  ] as const) {
    if (values.length !== timestamps.length) {
      throw new MarketDataValidationError(
        `indicators.quote[0].${path} length ${values.length} does not match timestamp length ${timestamps.length}.`,
      );
    }
  }

  return {
    closes,
    exchangeTimezoneName,
    highs,
    latestObservationMetadata: getLatestObservationMetadata(meta),
    lows,
    opens,
    timestamps,
    volumes,
  };
}

interface LocalTimestamp {
  readonly day: string;
  readonly minute: number;
  readonly second: number;
}

function createLocalTimestampFormatter(
  exchangeTimezoneName: string,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: exchangeTimezoneName,
    year: 'numeric',
  });
}

function getLocalTimestamp(
  formatter: Intl.DateTimeFormat,
  timestampMilliseconds: number,
): LocalTimestamp {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(timestampMilliseconds)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  const { day, minute, month, second, year } = parts;

  if (
    day === undefined ||
    minute === undefined ||
    month === undefined ||
    second === undefined ||
    year === undefined
  ) {
    throw new MarketDataValidationError(
      'Unable to derive an exchange-local timestamp.',
    );
  }

  return {
    day: `${year}-${month}-${day}`,
    minute: Number.parseInt(minute, 10),
    second: Number.parseInt(second, 10),
  };
}

function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isUsableVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function roundToFourDecimalPlaces(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function areNearlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(left), Math.abs(right)) * 1e-6;

  return Math.abs(left - right) <= tolerance;
}

interface ObservationCandidate {
  readonly close: unknown;
  readonly day: string;
  readonly high: unknown;
  readonly low: unknown;
  readonly open: unknown;
  readonly timestamp: number;
  readonly volume: unknown;
}

function isConfirmedLatestPriceObservation(
  candidate: ObservationCandidate,
  metadata: LatestObservationMetadata | undefined,
  formatter: Intl.DateTimeFormat,
): boolean {
  if (
    metadata === undefined ||
    !isUsablePrice(candidate.open) ||
    !isUsablePrice(candidate.low) ||
    !isUsablePrice(candidate.high) ||
    !isUsablePrice(candidate.close) ||
    candidate.volume !== 0
  ) {
    return false;
  }

  const sessionStartDay = getLocalTimestamp(
    formatter,
    metadata.sessionStart * 1_000,
  ).day;
  const sessionEndDay = getLocalTimestamp(
    formatter,
    metadata.sessionEnd * 1_000,
  ).day;
  const sessionLastMomentDay = getLocalTimestamp(
    formatter,
    metadata.sessionEnd * 1_000 - 1,
  ).day;
  const isOnCoveredSessionDate =
    candidate.day === sessionStartDay ||
    candidate.day === sessionEndDay ||
    candidate.day === sessionLastMomentDay;
  const isAtLatestPriceTime =
    candidate.timestamp === metadata.regularMarketTime;
  const isClosingObservation =
    candidate.timestamp === metadata.sessionEnd &&
    metadata.regularMarketTime >= metadata.sessionEnd &&
    metadata.regularMarketTime - metadata.sessionEnd <
      FIFTEEN_MINUTES_IN_SECONDS;
  const matchesLatestPrice = [
    candidate.open,
    candidate.low,
    candidate.high,
    candidate.close,
  ].every((price) => areNearlyEqual(price, metadata.regularMarketPrice));

  return (
    isOnCoveredSessionDate &&
    (isAtLatestPriceTime || isClosingObservation) &&
    matchesLatestPrice
  );
}

interface AggregateAccumulator {
  count: number;
  highTotal: number;
  lowTotal: number;
  volumeTotal: number;
}

/**
 * Aggregates a validated Yahoo chart result without performing I/O.
 *
 * Structurally malformed responses throw. Individual rows with unusable
 * aggregation values are skipped so the remaining data can still be
 * summarized.
 */
export function aggregateDailyData(
  input: unknown,
  currentTime: Date,
): DailyAggregate[] {
  if (Number.isNaN(currentTime.getTime())) {
    throw new MarketDataValidationError('currentTime must be a valid Date.');
  }

  const data = validateChartData(input);
  const formatter = createLocalTimestampFormatter(data.exchangeTimezoneName);
  const dailyTotals = new Map<string, AggregateAccumulator>();

  for (let index = 0; index < data.timestamps.length; index += 1) {
    const timestamp = data.timestamps[index];
    const low = data.lows[index];
    const high = data.highs[index];
    const volume = data.volumes[index];
    const open = data.opens?.[index];
    const close = data.closes?.[index];

    if (timestamp === undefined) {
      throw new MarketDataValidationError(
        `timestamp[${index}] unexpectedly disappeared after validation.`,
      );
    }

    const timestampMilliseconds = timestamp * 1_000;
    const localTimestamp = getLocalTimestamp(formatter, timestampMilliseconds);
    const isCompleted =
      timestamp + FIFTEEN_MINUTES_IN_SECONDS <=
      Math.floor(currentTime.getTime() / 1_000);

    if (!isCompleted) {
      continue;
    }

    if (
      !isUsablePrice(low) ||
      !isUsablePrice(high) ||
      !isUsableVolume(volume)
    ) {
      continue;
    }

    if (
      isConfirmedLatestPriceObservation(
        {
          close,
          day: localTimestamp.day,
          high,
          low,
          open,
          timestamp,
          volume,
        },
        data.latestObservationMetadata,
        formatter,
      )
    ) {
      continue;
    }

    const accumulator = dailyTotals.get(localTimestamp.day) ?? {
      count: 0,
      highTotal: 0,
      lowTotal: 0,
      volumeTotal: 0,
    };

    accumulator.count += 1;
    accumulator.highTotal += high;
    accumulator.lowTotal += low;
    accumulator.volumeTotal += volume;
    dailyTotals.set(localTimestamp.day, accumulator);
  }

  return [...dailyTotals.entries()]
    .sort(([leftDay], [rightDay]) => leftDay.localeCompare(rightDay))
    .map(([day, totals]) => ({
      day,
      lowAverage: roundToFourDecimalPlaces(totals.lowTotal / totals.count),
      highAverage: roundToFourDecimalPlaces(totals.highTotal / totals.count),
      volume: totals.volumeTotal,
    }));
}
