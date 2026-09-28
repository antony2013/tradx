import { afterEach, describe, expect, it } from 'vitest';
import { isValidInstrumentKey, UpstoxMarketFeedSource } from '../src/capture/upstox-source';
import type { CaptureSourceCallbacks } from '../src/capture/types';

function callbacks(): CaptureSourceCallbacks {
  return {
    onConnecting: () => undefined,
    onConnected: () => undefined,
    onReady: () => undefined,
    onBatch: () => undefined,
    onError: () => undefined,
    onDisconnected: () => undefined,
  };
}

type SentFrame = { guid: string; method: string; data: unknown };

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

function frames(socket: FakeSocket): SentFrame[] {
  return socket.sent.map(
    (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as SentFrame,
  );
}

const realWebSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;

function stubNetwork(uri: string): void {
  (globalThis as Record<string, unknown>).WebSocket = FakeSocket;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: { authorized_redirect_uri: uri } }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  globalThis.fetch = realFetch;
  FakeSocket.instances = [];
});

describe('instrument key validation', () => {
  it('accepts SEGMENT|id and rejects malformed keys', () => {
    expect(isValidInstrumentKey('NSE_EQ|INE002A01018')).toBe(true);
    expect(isValidInstrumentKey('NSE_FO|73985')).toBe(true);
    expect(isValidInstrumentKey('NSE_INDEX|Nifty 50')).toBe(true);
    expect(isValidInstrumentKey('NOPIPE')).toBe(false);
    expect(isValidInstrumentKey('|empty')).toBe(false);
    expect(isValidInstrumentKey('A|B|C')).toBe(false);
    expect(isValidInstrumentKey('')).toBe(false);
    expect(isValidInstrumentKey('NSE_EQ|   ')).toBe(false);
  });
});

describe('upstox source subscriptions', () => {
  it('subscribes the initial set on connect (single or many)', async () => {
    stubNetwork('wss://test/feed');
    const source = new UpstoxMarketFeedSource({
      authorizeUrl: 'https://x/authorize',
      accessToken: 't',
      instrumentKeys: ['NSE_FO|1', 'NSE_FO|2'],
      feedMode: 'ltpc',
      reconnectMinMs: 1,
      reconnectMaxMs: 5,
    });

    await source.start(callbacks());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(FakeSocket.instances).toHaveLength(1);
    const [frame] = frames(FakeSocket.instances[0] as FakeSocket);
    expect(frame?.method).toBe('sub');
    expect(frame?.data).toMatchObject({
      mode: 'ltpc',
      instrumentKeys: ['NSE_FO|1', 'NSE_FO|2'],
    });
    expect(source.getSubscribedKeys()).toEqual(['NSE_FO|1', 'NSE_FO|2']);
    await source.stop();
  });

  it('adds and removes keys at runtime with sub/unsub frames', async () => {
    stubNetwork('wss://test/feed');
    const errors: unknown[] = [];
    const source = new UpstoxMarketFeedSource({
      authorizeUrl: 'https://x/authorize',
      accessToken: 't',
      instrumentKeys: ['NSE_FO|1'],
      feedMode: 'full',
      reconnectMinMs: 1,
      reconnectMaxMs: 5,
    });

    await source.start({
      ...callbacks(),
      onError: (error) => errors.push(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const socket = FakeSocket.instances[0] as FakeSocket;

    const added = source.subscribe(['NSE_FO|2', 'BAD KEY', 'NSE_FO|1']);
    expect(added).toEqual({ added: ['NSE_FO|2'], invalid: ['BAD KEY'] });
    expect(source.getSubscribedKeys()).toEqual(['NSE_FO|1', 'NSE_FO|2']);

    const removed = source.unsubscribe(['NSE_FO|1', 'NSE_FO|9']);
    expect(removed).toEqual({ removed: ['NSE_FO|1'], missing: ['NSE_FO|9'] });
    expect(source.getSubscribedKeys()).toEqual(['NSE_FO|2']);

    const methods = frames(socket).map((frame) => frame.method);
    expect(methods).toEqual(['sub', 'sub', 'unsub']);
    const last = frames(socket).at(-1);
    expect(last?.data).toMatchObject({ instrumentKeys: ['NSE_FO|1'] });
    expect(errors).toHaveLength(0);
    await source.stop();
  });

  it('resubscribes the current set after reconnect', async () => {
    stubNetwork('wss://test/feed');
    const source = new UpstoxMarketFeedSource({
      authorizeUrl: 'https://x/authorize',
      accessToken: 't',
      instrumentKeys: ['NSE_FO|1'],
      feedMode: 'ltpc',
      reconnectMinMs: 1,
      reconnectMaxMs: 5,
    });

    await source.start(callbacks());
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.subscribe(['NSE_FO|2']);
    (FakeSocket.instances[0] as FakeSocket).close();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2);
    const latest = frames(
      FakeSocket.instances[FakeSocket.instances.length - 1] as FakeSocket,
    )[0];
    expect(latest?.method).toBe('sub');
    expect(latest?.data).toMatchObject({
      instrumentKeys: ['NSE_FO|1', 'NSE_FO|2'],
    });
    await source.stop();
  });
});
