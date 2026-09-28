import { canonicalize, sha256Hex } from '../capture/canonical';
import type { ValidatedHistoricalRequest } from './types';

export function computeDatasetId(request: ValidatedHistoricalRequest): string {
  const canonical = canonicalize({
    instrumentKey: request.instrumentKey,
    from: request.from,
    to: request.to,
    interval: request.interval,
    source: request.source,
    unit: request.unit,
  });
  return sha256Hex(JSON.stringify(canonical));
}
