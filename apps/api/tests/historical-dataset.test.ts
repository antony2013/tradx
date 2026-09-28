import { describe, expect, it } from 'vitest';
import { computeDatasetId } from '../src/historical/dataset-id';
import type { ValidatedHistoricalRequest } from '../src/historical/types';

function request(
  overrides: Partial<ValidatedHistoricalRequest> = {},
): ValidatedHistoricalRequest {
  return {
    instrumentKey: 'NSE_INDEX|Nifty 50',
    from: '2026-09-01',
    to: '2026-09-23',
    unit: 'days',
    interval: 1,
    source: 'upstox',
    expired: false,
    ...overrides,
  };
}

describe('deterministic dataset id', () => {
  it('maps the same request to the same id', () => {
    expect(computeDatasetId(request())).toBe(computeDatasetId(request()));
  });

  it('changes with instrument, range, interval, unit or source', () => {
    const base = computeDatasetId(request());
    expect(computeDatasetId(request({ instrumentKey: 'NSE_EQ|INE002A01018' }))).not.toBe(base);
    expect(computeDatasetId(request({ from: '2026-09-02' }))).not.toBe(base);
    expect(computeDatasetId(request({ to: '2026-09-22' }))).not.toBe(base);
    expect(computeDatasetId(request({ interval: 5, unit: 'minutes' }))).not.toBe(base);
    expect(computeDatasetId(request({ unit: 'weeks' }))).not.toBe(base);
    expect(computeDatasetId(request({ source: 'upstox' }))).toBe(base);
  });

  it('is a 64-char hex SHA-256', () => {
    expect(computeDatasetId(request())).toMatch(/^[0-9a-f]{64}$/);
  });
});
