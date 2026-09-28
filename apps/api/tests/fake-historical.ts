import { sha256Hex } from '../src/capture/canonical';
import { HistoricalError } from '../src/historical/errors';
import type {
  FetchedChunk,
  HistoricalClient,
  HistoricalErrorCode,
  NormalizedCandle,
} from '../src/historical/types';

export type ScriptedChunk =
  | { kind: 'data'; candles: NormalizedCandle[] }
  | { kind: 'error'; code: HistoricalErrorCode; message?: string }
  | { kind: 'gate'; gate: Promise<void>; then: ScriptedChunk };

/**
 * Deterministic fake Upstox historical API. Test-only: production code
 * must always use the real Upstox client/configuration.
 *
 * Each chunk index maps to a script queue; calls beyond the script fall
 * back to the last entry. Calls are recorded in order for sequencing
 * assertions.
 */
export class FakeHistoricalClient implements HistoricalClient {
  readonly calls: Array<{
    from: string;
    to: string;
    chunkIndex: number;
    expired: boolean;
  }> = [];

  constructor(private readonly script: Map<number, ScriptedChunk[]>) {}

  async fetchChunk(input: {
    instrumentKey: string;
    from: string;
    to: string;
    chunkIndex: number;
  }): Promise<FetchedChunk> {
    return this.next({ ...input, expired: false });
  }

  async fetchExpiredChunk(input: {
    expiredKey: string;
    from: string;
    to: string;
    chunkIndex: number;
  }): Promise<FetchedChunk> {
    return this.next({ ...input, expired: true });
  }

  private async next(input: {
    from: string;
    to: string;
    chunkIndex: number;
    expired: boolean;
  }): Promise<FetchedChunk> {
    this.calls.push({
      from: input.from,
      to: input.to,
      chunkIndex: input.chunkIndex,
      expired: input.expired,
    });
    const queue = this.script.get(input.chunkIndex) ?? [
      { kind: 'data', candles: [] as NormalizedCandle[] },
    ];
    const step = queue.length > 1 ? (queue.shift() as ScriptedChunk) : queue[0] as ScriptedChunk;
    return this.run(step);
  }

  private async run(step: ScriptedChunk): Promise<FetchedChunk> {
    if (step.kind === 'gate') {
      await step.gate;
      return this.run(step.then);
    }
    if (step.kind === 'error') {
      throw new HistoricalError(step.code, step.message ?? step.code);
    }
    const rawText = JSON.stringify({
      status: 'success',
      data: {
        candles: step.candles.map((c) => [
          new Date(c.timestamp).toISOString(),
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
          c.openInterest,
        ]),
      },
    });
    return {
      candles: [...step.candles].sort((a, b) => a.timestamp - b.timestamp),
      rawText,
      responseHash: sha256Hex(rawText),
      respondedAt: Date.now(),
    };
  }
}

export function candle(
  isoDay: string,
  open: number,
  overrides: Partial<NormalizedCandle> = {},
): NormalizedCandle {
  const timestamp = Date.parse(`${isoDay}T00:00:00Z`);
  return {
    timestamp,
    open,
    high: open + 10,
    low: open - 10,
    close: open + 5,
    volume: 1000,
    openInterest: null,
    ...overrides,
  };
}
