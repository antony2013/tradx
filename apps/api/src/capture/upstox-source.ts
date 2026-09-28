import type { Logger } from '../lib/logger';
import { uuidv7 } from './uuid';
import type {
  CaptureSource,
  CaptureSourceCallbacks,
  FeedMode,
  SubscribableSource,
  SubscriptionChange,
} from './types';

export type UpstoxSourceConfig = {
  authorizeUrl: string;
  accessToken: string;
  instrumentKeys: string[];
  feedMode: FeedMode;
  reconnectMinMs: number;
  reconnectMaxMs: number;
};

type AuthorizeResponse = {
  status?: string;
  data?: {
    authorized_redirect_uri?: string;
  };
};

/**
 * Upstox instrument_key shape: SEGMENT|id (e.g. NSE_EQ|INE002A01018,
 * NSE_FO|73985, NSE_INDEX|Nifty 50). Exactly one pipe; both sides
 * non-empty after trimming.
 */
export function isValidInstrumentKey(key: string): boolean {
  if (typeof key !== 'string') {
    return false;
  }
  const parts = key.split('|');
  return (
    parts.length === 2 &&
    (parts[0]?.trim().length ?? 0) > 0 &&
    (parts[1]?.trim().length ?? 0) > 0
  );
}

/**
 * Upstox Market Data Feed v3 WebSocket source.
 *
 * Flow: authorize (REST) -> connect -> subscribe -> protobuf binary frames.
 * Every (re)connect mints a fresh source_connection_id so lineage
 * `connection -> batches -> instrument messages` can be reconstructed.
 * Reconnect uses bounded exponential backoff. Authorization failures are
 * fatal (no retry) and surface as AUTHORIZE_FAILED.
 *
 * Subscriptions are mutable at runtime (single key or many): subscribe()
 * and unsubscribe() update the tracked set immediately and push sub/unsub
 * control frames when connected; reconnects always resubscribe the full
 * current set.
 *
 * The access token is only ever sent in the Authorization header.
 * It is never logged.
 */
export class UpstoxMarketFeedSource
  implements CaptureSource, SubscribableSource {
  private running = false;
  private socket: WebSocket | null = null;
  private connectionId: string | null = null;
  private loop: Promise<void> | null = null;
  private readonly subscribedKeys: Set<string>;

  constructor(
    private readonly config: UpstoxSourceConfig,
    private readonly callbacksHolder: { current: CaptureSourceCallbacks | null } = {
      current: null,
    },
    private readonly logger: Logger | null = null,
  ) {
    this.subscribedKeys = new Set(
      config.instrumentKeys.filter(isValidInstrumentKey),
    );
  }

  start(callbacks: CaptureSourceCallbacks): Promise<void> {
    this.callbacksHolder.current = callbacks;
    if (this.running) {
      return this.loop ?? Promise.resolve();
    }
    this.running = true;
    this.loop = this.connectLoop(callbacks);
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.running = false;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, 'capture stopping');
    } catch {
      // ignore close errors during shutdown
    }
    await this.loop?.catch(() => undefined);
    this.loop = null;
  }

  getSubscribedKeys(): string[] {
    return [...this.subscribedKeys].sort();
  }

  getFeedMode(): string {
    return this.config.feedMode;
  }

  subscribe(keys: string[]): SubscriptionChange {
    const added: string[] = [];
    const invalid: string[] = [];
    for (const key of keys) {
      if (!isValidInstrumentKey(key)) {
        invalid.push(key);
      } else if (!this.subscribedKeys.has(key)) {
        this.subscribedKeys.add(key);
        added.push(key);
      }
    }
    if (added.length > 0) {
      this.sendControl('sub', added);
    }
    return { added, invalid };
  }

  unsubscribe(keys: string[]): SubscriptionChange {
    const removed: string[] = [];
    const missing: string[] = [];
    for (const key of keys) {
      if (this.subscribedKeys.delete(key)) {
        removed.push(key);
      } else {
        missing.push(key);
      }
    }
    if (removed.length > 0) {
      this.sendControl('unsub', removed);
    }
    return { removed, missing };
  }

  private sendControl(method: 'sub' | 'unsub', keys: string[]): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    try {
      socket.send(
        new TextEncoder().encode(
          JSON.stringify({
            guid: uuidv7(),
            method,
            data: { mode: this.config.feedMode, instrumentKeys: keys },
          }),
        ),
      );
    } catch (error) {
      this.callbacksHolder.current?.onError({
        sourceConnectionId: this.connectionId ?? undefined,
        stage: 'RECEIVE',
        errorCode: 'SUBSCRIBE_FAILED',
        errorMessage:
          error instanceof Error ? error.message : 'Subscribe failed',
      });
    }
  }

  private async connectLoop(callbacks: CaptureSourceCallbacks): Promise<void> {
    let attempt = 0;

    while (this.running) {
      const connectionId = uuidv7();
      this.connectionId = connectionId;
      callbacks.onConnecting(connectionId);

      let authorizedUri: string;
      try {
        authorizedUri = await this.authorize();
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('AUTHORIZE_FAILED')
        ) {
          callbacks.onError({
            sourceConnectionId: connectionId,
            stage: 'RECEIVE',
            errorCode: 'AUTHORIZE_FAILED',
            errorMessage: error.message,
          });
          this.running = false;
          return;
        }
        await this.sleep(this.backoffMs(attempt));
        attempt += 1;
        continue;
      }

      try {
        await this.connectOnce(authorizedUri, connectionId, callbacks);
        attempt = 0;
      } catch {
        // connectOnce resolves only after the socket closes; a throw
        // means the connection never established.
        attempt += 1;
      }

      if (!this.running) {
        return;
      }

      callbacks.onDisconnected(
        connectionId,
        undefined,
        'reconnecting with a new connection id',
      );
      await this.sleep(this.backoffMs(attempt));
      attempt += 1;
    }
  }

  private async authorize(): Promise<string> {
    const response = await fetch(this.config.authorizeUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `AUTHORIZE_FAILED: market-data authorize rejected with ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new Error(`Authorize request failed with ${response.status}`);
    }

    const body = (await response.json()) as AuthorizeResponse;
    const uri = body.data?.authorized_redirect_uri;
    if (!uri) {
      throw new Error('Authorize response missing authorized_redirect_uri');
    }
    return uri;
  }

  private connectOnce(
    url: string,
    connectionId: string,
    callbacks: CaptureSourceCallbacks,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const socket = new WebSocket(url);
      this.socket = socket;

      const settle = () => {
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          if (this.socket === socket) {
            this.socket = null;
          }
          resolve();
        }
      };

      // Guard: never hang the reconnect loop on a socket that stays silent.
      const openTimer = setTimeout(() => {
        try {
          socket.close(1011, 'connect timeout');
        } catch {
          // ignore
        }
        settle();
      }, 15000);

      socket.onopen = () => {
        callbacks.onConnected(connectionId);
        // Upstox v3 control frames are binary JSON: the JSON payload
        // must go out as a binary WS frame, not a text frame.
        // Always (re)subscribe the full current set on (re)connect.
        const keys = this.getSubscribedKeys();
        if (keys.length > 0) {
          this.sendControl('sub', keys);
        }
        callbacks.onReady(connectionId);
      };

      socket.onmessage = (event: MessageEvent) => {
        void this.handleMessage(event.data, connectionId, callbacks);
      };

      socket.onerror = () => {
        callbacks.onError({
          sourceConnectionId: connectionId,
          stage: 'RECEIVE',
          errorCode: 'WS_ERROR',
          errorMessage: 'WebSocket error',
        });
      };

      socket.onclose = () => {
        settle();
      };
    });
  }

  private async handleMessage(
    data: unknown,
    connectionId: string,
    callbacks: CaptureSourceCallbacks,
  ): Promise<void> {
    if (typeof data === 'string') {
      return;
    }

    let bytes: Uint8Array | null = null;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (
      typeof Blob !== 'undefined' &&
      data instanceof Blob
    ) {
      bytes = new Uint8Array(await data.arrayBuffer());
    } else if (
      data &&
      typeof data === 'object' &&
      'buffer' in data &&
      (data as { buffer: unknown }).buffer instanceof ArrayBuffer
    ) {
      const view = data as ArrayBufferView;
      bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }

    if (!bytes || bytes.length === 0) {
      return;
    }

    // Binary JSON frames are server control messages (subscribe acks,
    // errors) — not market data. Keep them out of the capture pipeline
    // and log them for observability instead.
    if (isJsonFrame(bytes)) {
      this.logger?.debug(
        'websocket_control_frame',
        'Market-data control frame received',
        { detail: new TextDecoder().decode(bytes).slice(0, 500) },
      );
      return;
    }

    await callbacks.onBatch(bytes, Date.now());
  }

  private backoffMs(attempt: number): number {
    const capped = Math.min(attempt, 10);
    const exponential = this.config.reconnectMinMs * 2 ** capped;
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(exponential + jitter, this.config.reconnectMaxMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms));
    });
  }
}

function isJsonFrame(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      continue;
    }
    return byte === 0x7b; // '{'
  }
  return false;
}
