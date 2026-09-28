import { hashCanonical } from './canonical';
import { uuidv7 } from './uuid';
import type {
  CaptureBatch,
  FeedMode,
  FeedResponse,
  InstrumentMessage,
} from './types';

export type BuildCaptureBatchInput = {
  response: FeedResponse;
  rawPayload: Uint8Array;
  sourceConnectionId: string;
  receivedTs: number;
  sessionDate: string;
  feedMode: FeedMode;
  schemaVersion: string;
};

function parseTimestamp(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`Invalid epoch millisecond timestamp: ${String(value)}`);
  }

  return timestamp;
}

export function canonicalFeedResponse(response: FeedResponse): unknown {
  return {
    type: response.type,
    feeds: response.feeds,
    ...(response.currentTs === undefined ? {} : { currentTs: response.currentTs }),
    ...(response.marketInfo === undefined
      ? {}
      : { marketInfo: response.marketInfo }),
  };
}

export function extractLtt(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  // Collect every object shaped like an Ltpc feed slice:
  // - a direct `ltpc` slice (ltpc feed mode),
  // - market/index sections of a `fullFeed` slice,
  // - the `ltpc` leg of a `firstLevelWithGreeks` slice,
  // - a bare ltpc-shaped object.
  const value = payload as Record<string, unknown>;
  const ltpcObjects: unknown[] = [];

  if (value.ltpc && typeof value.ltpc === 'object') {
    ltpcObjects.push(value.ltpc);
  }

  const fullFeed = value.fullFeed;
  if (fullFeed && typeof fullFeed === 'object') {
    const sections = fullFeed as Record<string, unknown>;
    for (const key of ['marketFF', 'indexFF']) {
      const section = sections[key];
      if (section && typeof section === 'object') {
        const ltpc = (section as Record<string, unknown>).ltpc;
        if (ltpc && typeof ltpc === 'object') {
          ltpcObjects.push(ltpc);
        }
      }
    }
  }

  const firstLevelWithGreeks = value.firstLevelWithGreeks;
  if (firstLevelWithGreeks && typeof firstLevelWithGreeks === 'object') {
    const ltpc = (firstLevelWithGreeks as Record<string, unknown>).ltpc;
    if (ltpc && typeof ltpc === 'object') {
      ltpcObjects.push(ltpc);
    }
  }

  if ('ltt' in value) {
    ltpcObjects.push(value);
  }

  for (const ltpc of ltpcObjects) {
    const timestamp = (ltpc as Record<string, unknown>).ltt;
    const parsed = parseTimestamp(
      typeof timestamp === 'string' || typeof timestamp === 'number'
        ? timestamp
        : undefined,
    );
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

export function buildCaptureBatch(input: BuildCaptureBatchInput): CaptureBatch {
  const currentTs = parseTimestamp(input.response.currentTs);
  const instruments: InstrumentMessage[] = Object.entries(
    input.response.feeds,
  ).map(([instrumentKey, payload]) => ({
    instrumentKey,
    currentTs,
    ltt: extractLtt(payload),
    payload,
    payloadHash: hashCanonical(payload),
  }));

  return {
    batchId: uuidv7(input.receivedTs),
    sourceConnectionId: input.sourceConnectionId,
    receivedTs: input.receivedTs,
    currentTs,
    sessionDate: input.sessionDate,
    feedMode: input.feedMode as CaptureBatch['feedMode'],
    schemaVersion: input.schemaVersion,
    batchHash: hashCanonical(canonicalFeedResponse(input.response)),
    rawPayload: new Uint8Array(input.rawPayload),
    instruments,
  };
}
