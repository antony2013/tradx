import type {
  CaptureSource,
  CaptureSourceCallbacks,
} from '../src/capture/types';

/**
 * Deterministic in-process stand-in for the Upstox WebSocket source.
 * Test-only: production code must never use fake market data.
 */
export class FakeCaptureSource implements CaptureSource {
  callbacks: CaptureSourceCallbacks | null = null;
  started = false;
  stopped = false;
  connectionId: string;

  constructor(connectionId = 'test-connection-1') {
    this.connectionId = connectionId;
  }

  start(callbacks: CaptureSourceCallbacks): void {
    this.callbacks = callbacks;
    this.started = true;
    callbacks.onConnecting(this.connectionId);
    callbacks.onConnected(this.connectionId);
    callbacks.onReady(this.connectionId);
  }

  stop(): void {
    this.stopped = true;
    this.callbacks?.onDisconnected(this.connectionId, 1000, 'test stop');
  }

  reconnect(connectionId: string): void {
    this.callbacks?.onDisconnected(this.connectionId, 1006, 'test reconnect');
    this.connectionId = connectionId;
    this.callbacks?.onConnecting(connectionId);
    this.callbacks?.onConnected(connectionId);
    this.callbacks?.onReady(connectionId);
  }

  push(payload: Uint8Array, receivedTs: number): Promise<void> {
    if (!this.callbacks) {
      throw new Error('FakeCaptureSource not started');
    }
    const result = this.callbacks.onBatch(payload, receivedTs);
    return result ?? Promise.resolve();
  }
}
