import { describe, expect, it } from 'vitest';
import {
  buildCaptureBatch,
  canonicalFeedResponse,
  extractLtt,
} from '../src/capture/batch';
import { hashCanonical } from '../src/capture/canonical';
import type { FeedResponse } from '../src/capture/types';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function feedResponse(): FeedResponse {
  return {
    type: 2,
    feeds: {
      'NSE_EQ|INE002A01018': {
        ltpc: { ltp: 2431.5, ltt: '1758604200000', ltq: '10', cp: 2400 },
      },
      'NSE_EQ|INE238A01034': {
        ltpc: { ltp: 512.25, ltt: '1758604201000', ltq: '5', cp: 500 },
      },
    },
    currentTs: '1758604202000',
  };
}

describe('batch fan-out', () => {
  it('builds one batch with N instrument slices', () => {
    const response = feedResponse();
    const rawPayload = new Uint8Array([1, 2, 3]);

    const batch = buildCaptureBatch({
      response,
      rawPayload,
      sourceConnectionId: 'conn-1',
      receivedTs: 1758604202500,
      sessionDate: '2026-09-23',
      feedMode: 'full',
      schemaVersion: 'upstox-v3-raw-1',
    });

    expect(batch.instruments).toHaveLength(2);
    expect(batch.batchId).toMatch(UUID_V7_PATTERN);
    expect(batch.sourceConnectionId).toBe('conn-1');
    expect(batch.receivedTs).toBe(1758604202500);
    expect(batch.currentTs).toBe(1758604202000);
    expect(batch.sessionDate).toBe('2026-09-23');
    expect(batch.feedMode).toBe('full');
    expect(batch.schemaVersion).toBe('upstox-v3-raw-1');
  });

  it('never derives batch_id from current_ts', () => {
    const input = {
      response: feedResponse(),
      rawPayload: new Uint8Array([9]),
      sourceConnectionId: 'conn-1',
      receivedTs: 1758604202500,
      sessionDate: '2026-09-23',
      feedMode: 'ltpc' as const,
      schemaVersion: 'upstox-v3-raw-1',
    };

    const first = buildCaptureBatch(input);
    const second = buildCaptureBatch(input);

    expect(first.batchId).not.toBe(second.batchId);
    expect(first.currentTs).toBe(second.currentTs);
  });

  it('stores only the instrument slice in each row payload', () => {
    const response = feedResponse();
    const batch = buildCaptureBatch({
      response,
      rawPayload: new Uint8Array([1]),
      sourceConnectionId: 'conn-1',
      receivedTs: 1,
      sessionDate: '2026-09-23',
      feedMode: 'ltpc',
      schemaVersion: 'upstox-v3-raw-1',
    });

    for (const instrument of batch.instruments) {
      expect(instrument.payload).toEqual(
        response.feeds[instrument.instrumentKey],
      );
      expect(instrument.payloadHash).toBe(
        hashCanonical(response.feeds[instrument.instrumentKey]),
      );
    }
  });

  it('hashes the batch and instruments differently', () => {
    const batch = buildCaptureBatch({
      response: feedResponse(),
      rawPayload: new Uint8Array([1]),
      sourceConnectionId: 'conn-1',
      receivedTs: 1,
      sessionDate: '2026-09-23',
      feedMode: 'ltpc',
      schemaVersion: 'upstox-v3-raw-1',
    });

    expect(batch.batchHash).toBe(
      hashCanonical(canonicalFeedResponse(feedResponse())),
    );
    for (const instrument of batch.instruments) {
      expect(instrument.payloadHash).not.toBe(batch.batchHash);
    }
  });

  it('copies the raw payload instead of aliasing it', () => {
    const rawPayload = new Uint8Array([1, 2, 3]);
    const batch = buildCaptureBatch({
      response: feedResponse(),
      rawPayload,
      sourceConnectionId: 'conn-1',
      receivedTs: 1,
      sessionDate: '2026-09-23',
      feedMode: 'ltpc',
      schemaVersion: 'upstox-v3-raw-1',
    });

    rawPayload[0] = 99;
    expect(batch.rawPayload[0]).toBe(1);
  });

  it('rejects invalid timestamps instead of storing garbage', () => {
    expect(() =>
      buildCaptureBatch({
        response: { type: 1, feeds: {}, currentTs: 'not-a-number' },
        rawPayload: new Uint8Array([1]),
        sourceConnectionId: 'conn-1',
        receivedTs: 1,
        sessionDate: '2026-09-23',
        feedMode: 'ltpc',
        schemaVersion: 'upstox-v3-raw-1',
      }),
    ).toThrow();
  });
});

describe('timestamp semantics', () => {
  it('extracts instrument ltt without requiring it to track current_ts', () => {
    expect(
      extractLtt({ ltpc: { ltt: '1758604200000' } }),
    ).toBe(1758604200000);
    expect(extractLtt({ ltpc: { ltp: 10 } })).toBeUndefined();
    expect(extractLtt(null)).toBeUndefined();
  });

  it('keeps batch current_ts and instrument ltt in separate fields', () => {
    const batch = buildCaptureBatch({
      response: feedResponse(),
      rawPayload: new Uint8Array([1]),
      sourceConnectionId: 'conn-1',
      receivedTs: 1758604300000,
      sessionDate: '2026-09-23',
      feedMode: 'ltpc',
      schemaVersion: 'upstox-v3-raw-1',
    });

    expect(batch.currentTs).toBe(1758604202000);
    expect(batch.receivedTs).toBe(1758604300000);
    const first = batch.instruments[0];
    expect(first?.ltt).toBe(1758604200000);
    expect(first?.currentTs).toBe(1758604202000);
  });
});
