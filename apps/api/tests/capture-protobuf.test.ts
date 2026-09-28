import { describe, expect, it } from 'vitest';
import { decodeFeedResponse } from '../src/capture/protobuf';
import {
  encodeFeed,
  encodeFeedResponse,
  encodeLtpc,
} from './encode-feed';

describe('protobuf feed decoding', () => {
  it('round-trips a two-instrument batch', () => {
    const bytes = encodeFeedResponse({
      type: 2,
      currentTs: 1758604202000,
      feeds: {
        'NSE_EQ|INE002A01018': encodeFeed(
          encodeLtpc({ ltp: 2431.5, ltt: 1758604200000, ltq: 10, cp: 2400 }),
        ),
        'NSE_EQ|INE238A01034': encodeFeed(
          encodeLtpc({ ltp: 512.25, ltt: 1758604201000, ltq: 5, cp: 500 }),
        ),
      },
    });

    const { response, issues } = decodeFeedResponse(bytes);

    expect(issues).toHaveLength(0);
    expect(response.type).toBe(2);
    expect(response.currentTs).toBe('1758604202000');
    expect(Object.keys(response.feeds)).toHaveLength(2);
    expect(response.feeds['NSE_EQ|INE002A01018']).toEqual({
      ltpc: { ltp: 2431.5, ltt: '1758604200000', ltq: '10', cp: 2400 },
    });
  });

  it('isolates a malformed instrument without losing valid ones', () => {
    const bytes = encodeFeedResponse({
      type: 1,
      currentTs: 100,
      feeds: {
        'NSE_EQ|GOOD': encodeFeed(encodeLtpc({ ltp: 1.5 })),
        // Field 1 (ltpc) claims 8 bytes but only 2 follow: the map key
        // parses fine, the Feed value fails -> per-instrument issue.
        'NSE_EQ|BAD': new Uint8Array([0x0a, 0x08, 0x01, 0x02]),
      },
    });

    const { response, issues } = decodeFeedResponse(bytes);

    expect(response.feeds['NSE_EQ|GOOD']).toBeDefined();
    expect(response.feeds['NSE_EQ|BAD']).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.instrumentKey).toBe('NSE_EQ|BAD');
    expect(issues[0]?.errorCode).toBe('MALFORMED_INSTRUMENT_FEED');
  });

  it('rejects truncated top-level input instead of returning partial data', () => {
    expect(() => decodeFeedResponse(new Uint8Array([0xff]))).toThrow();
    expect(() =>
      decodeFeedResponse(new Uint8Array([0x12, 0x05, 0x01])),
    ).toThrow();
  });
});
