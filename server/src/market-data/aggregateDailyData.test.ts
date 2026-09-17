import { describe, expect, it } from 'vitest';

import {
  aggregateDailyData,
  MarketDataValidationError,
  UnsupportedGranularityError,
} from './aggregateDailyData.js';

interface ChartFixtureOptions {
  readonly closes?: readonly unknown[];
  readonly granularity?: string;
  readonly highs?: readonly unknown[];
  readonly latestObservation?: {
    readonly regularMarketPrice: number;
    readonly regularMarketTime: number;
    readonly sessionEnd: number;
    readonly sessionStart: number;
  };
  readonly lows?: readonly unknown[];
  readonly opens?: readonly unknown[];
  readonly timestamps?: readonly number[];
  readonly timezone?: string;
  readonly volumes?: readonly unknown[];
}

function toTimestamp(isoTimestamp: string): number {
  return Math.floor(new Date(isoTimestamp).getTime() / 1_000);
}

function chartFixture({
  closes,
  granularity = '15m',
  highs = [],
  latestObservation,
  lows = [],
  opens,
  timestamps = [],
  timezone = 'America/New_York',
  volumes = [],
}: ChartFixtureOptions = {}) {
  return {
    meta: {
      ...(latestObservation === undefined
        ? {}
        : {
            currentTradingPeriod: {
              regular: {
                end: latestObservation.sessionEnd,
                start: latestObservation.sessionStart,
              },
            },
            regularMarketPrice: latestObservation.regularMarketPrice,
            regularMarketTime: latestObservation.regularMarketTime,
          }),
      dataGranularity: granularity,
      exchangeTimezoneName: timezone,
    },
    timestamp: timestamps,
    indicators: {
      quote: [
        {
          ...(closes === undefined ? {} : { close: closes }),
          high: highs,
          low: lows,
          ...(opens === undefined ? {} : { open: opens }),
          volume: volumes,
        },
      ],
    },
  };
}

describe('aggregateDailyData', () => {
  it('matches a hand-calculated example and preserves zero volume', () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-09-14T13:30:00Z'),
        toTimestamp('2026-09-14T13:45:00Z'),
        toTimestamp('2026-09-14T14:00:00Z'),
        toTimestamp('2026-09-15T13:30:00Z'),
      ],
      lows: [10.12345, 10.23456, 10.34567, 20],
      highs: [11.98765, 12.09876, 12.20987, 21],
      volumes: [100, 0, 250, 50],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T18:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-14',
          highAverage: 12.0988,
          lowAverage: 10.2346,
          volume: 350,
        },
        {
          day: '2026-09-15',
          highAverage: 21,
          lowAverage: 20,
          volume: 50,
        },
      ],
    );
  });

  it('uses exchange-local dates across the daylight-saving transition', () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-03-06T20:45:00Z'),
        toTimestamp('2026-03-09T13:30:00Z'),
      ],
      lows: [100, 200],
      highs: [110, 210],
      volumes: [10, 20],
    });

    expect(aggregateDailyData(input, new Date('2026-03-10T16:00:00Z'))).toEqual(
      [
        {
          day: '2026-03-06',
          highAverage: 110,
          lowAverage: 100,
          volume: 10,
        },
        {
          day: '2026-03-09',
          highAverage: 210,
          lowAverage: 200,
          volume: 20,
        },
      ],
    );
  });

  it('skips rows with missing values, keeps zero volume, and retains a partial day', () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-09-14T13:30:00Z'),
        toTimestamp('2026-09-14T13:45:00Z'),
        toTimestamp('2026-09-14T14:00:00Z'),
      ],
      lows: [10, null, 12],
      highs: [11, 13, 14],
      volumes: [0, 20, undefined],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T18:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-14',
          highAverage: 11,
          lowAverage: 10,
          volume: 0,
        },
      ],
    );
  });

  it('returns an empty result for empty input or when no row is usable', () => {
    const empty = chartFixture();
    const unusable = chartFixture({
      timestamps: [toTimestamp('2026-09-14T13:30:00Z')],
      lows: [null],
      highs: [undefined],
      volumes: [null],
    });
    const currentTime = new Date('2026-09-16T18:00:00Z');

    expect(aggregateDailyData(empty, currentTime)).toEqual([]);
    expect(aggregateDailyData(unusable, currentTime)).toEqual([]);
  });

  it('rejects arrays that are not aligned', () => {
    const input = chartFixture({
      timestamps: [toTimestamp('2026-09-14T13:30:00Z')],
      lows: [10],
      highs: [],
      volumes: [100],
    });

    expect(() =>
      aggregateDailyData(input, new Date('2026-09-16T18:00:00Z')),
    ).toThrow(MarketDataValidationError);
  });

  it('rejects data that Yahoo did not provide at 15-minute granularity', () => {
    const input = chartFixture({ granularity: '1d' });

    expect(() =>
      aggregateDailyData(input, new Date('2026-09-16T18:00:00Z')),
    ).toThrow(UnsupportedGranularityError);
  });

  it("includes today's completed bars and a bar that completes exactly at the supplied current time", () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-09-16T13:30:00Z'),
        toTimestamp('2026-09-16T13:45:00Z'),
        toTimestamp('2026-09-16T14:00:00Z'),
      ],
      lows: [10, 20, 30],
      highs: [12, 22, 32],
      volumes: [100, 200, 300],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T14:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-16',
          highAverage: 17,
          lowAverage: 15,
          volume: 300,
        },
      ],
    );
  });

  it('excludes a closing-price observation when current-session metadata supports the classification', () => {
    const sessionStart = toTimestamp('2026-09-16T13:30:00Z');
    const sessionEnd = toTimestamp('2026-09-16T20:00:00Z');
    const input = chartFixture({
      closes: [358.13, 358.0799865722656],
      highs: [359.3, 358.0799865722656],
      latestObservation: {
        regularMarketPrice: 358.08,
        regularMarketTime: sessionEnd + 1,
        sessionEnd,
        sessionStart,
      },
      lows: [357.09, 358.0799865722656],
      opens: [357.76, 358.0799865722656],
      timestamps: [toTimestamp('2026-09-16T19:45:00Z'), sessionEnd],
      volumes: [200, 0],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T21:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-16',
          highAverage: 359.3,
          lowAverage: 357.09,
          volume: 200,
        },
      ],
    );
  });

  it('excludes an off-grid latest-price observation when its timestamp and price match metadata', () => {
    const sessionStart = toTimestamp('2026-09-17T00:00:00Z');
    const sessionEnd = toTimestamp('2026-09-17T06:30:00Z');
    const regularMarketTime = toTimestamp('2026-09-17T00:45:04Z');
    const input = chartFixture({
      closes: [3026, null, 3025],
      highs: [3035, null, 3025],
      latestObservation: {
        regularMarketPrice: 3025,
        regularMarketTime,
        sessionEnd,
        sessionStart,
      },
      lows: [3026, null, 3025],
      opens: [3033, null, 3025],
      timestamps: [
        toTimestamp('2026-09-17T00:30:00Z'),
        toTimestamp('2026-09-17T00:45:00Z'),
        regularMarketTime,
      ],
      timezone: 'Asia/Tokyo',
      volumes: [630_500, null, 0],
    });

    expect(aggregateDailyData(input, new Date('2026-09-17T01:15:04Z'))).toEqual(
      [
        {
          day: '2026-09-17',
          highAverage: 3035,
          lowAverage: 3026,
          volume: 630_500,
        },
      ],
    );
  });

  it('retains legitimate zero-volume bars and historical partial days outside the metadata-covered session date', () => {
    const sessionStart = toTimestamp('2026-09-16T13:30:00Z');
    const sessionEnd = toTimestamp('2026-09-16T20:00:00Z');
    const input = chartFixture({
      closes: [358.08, 11],
      highs: [358.08, 12],
      latestObservation: {
        regularMarketPrice: 358.08,
        regularMarketTime: sessionEnd + 1,
        sessionEnd,
        sessionStart,
      },
      lows: [358.08, 10],
      opens: [358.08, 10.5],
      timestamps: [
        toTimestamp('2026-09-15T20:00:00Z'),
        toTimestamp('2026-09-16T13:30:00Z'),
      ],
      volumes: [0, 0],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T18:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-15',
          highAverage: 358.08,
          lowAverage: 358.08,
          volume: 0,
        },
        {
          day: '2026-09-16',
          highAverage: 12,
          lowAverage: 10,
          volume: 0,
        },
      ],
    );
  });

  it('retains an off-grid observation when metadata cannot reliably classify it', () => {
    const input = chartFixture({
      highs: [25],
      lows: [25],
      timestamps: [toTimestamp('2026-09-15T20:00:04Z')],
      volumes: [0],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T18:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-15',
          highAverage: 25,
          lowAverage: 25,
          volume: 0,
        },
      ],
    );
  });

  it('rejects unsorted timestamps', () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-09-14T13:45:00Z'),
        toTimestamp('2026-09-14T13:30:00Z'),
      ],
      lows: [10, 11],
      highs: [20, 21],
      volumes: [100, 200],
    });

    expect(() =>
      aggregateDailyData(input, new Date('2026-09-16T18:00:00Z')),
    ).toThrow(/strictly ascending/);
  });

  it('rejects duplicate timestamps rather than double counting a bar', () => {
    const timestamp = toTimestamp('2026-09-14T13:30:00Z');
    const input = chartFixture({
      timestamps: [timestamp, timestamp],
      lows: [10, 11],
      highs: [20, 21],
      volumes: [100, 200],
    });

    expect(() =>
      aggregateDailyData(input, new Date('2026-09-16T18:00:00Z')),
    ).toThrow(/duplicate/);
  });

  it('rounds to four decimal places only after calculating the average', () => {
    const input = chartFixture({
      timestamps: [
        toTimestamp('2026-09-14T13:30:00Z'),
        toTimestamp('2026-09-14T13:45:00Z'),
        toTimestamp('2026-09-14T14:00:00Z'),
      ],
      lows: [1.00004, 1.00004, 1.00007],
      highs: [2.00004, 2.00004, 2.00007],
      volumes: [1, 1, 1],
    });

    expect(aggregateDailyData(input, new Date('2026-09-16T18:00:00Z'))).toEqual(
      [
        {
          day: '2026-09-14',
          highAverage: 2.0001,
          lowAverage: 1.0001,
          volume: 3,
        },
      ],
    );
  });
});
