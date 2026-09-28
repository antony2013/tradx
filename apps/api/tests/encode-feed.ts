/**
 * Minimal hand-rolled protobuf encoder for tests.
 * Mirrors the Upstox MarketDataFeed v3 field layout consumed by
 * src/capture/protobuf.ts — test-only, no production use.
 */

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeVarint(value: number | bigint): Uint8Array {
  let remaining = typeof value === 'bigint' ? value : BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0x7fn) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return new Uint8Array(bytes);
}

export function encodeTag(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

export function encodeLenField(
  fieldNumber: number,
  payload: Uint8Array,
): Uint8Array {
  return concat([
    encodeTag(fieldNumber, 2),
    encodeVarint(payload.length),
    payload,
  ]);
}

export function encodeVarintField(
  fieldNumber: number,
  value: number | bigint,
): Uint8Array {
  return concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

export function encodeFixed64Field(
  fieldNumber: number,
  value: number,
): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return concat([encodeTag(fieldNumber, 1), bytes]);
}

export function encodeStringField(
  fieldNumber: number,
  value: string,
): Uint8Array {
  return encodeLenField(fieldNumber, new TextEncoder().encode(value));
}

export function encodeLtpc(input: {
  ltp?: number;
  ltt?: number;
  ltq?: number;
  cp?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (input.ltp !== undefined) {
    parts.push(encodeFixed64Field(1, input.ltp));
  }
  if (input.ltt !== undefined) {
    parts.push(encodeVarintField(2, input.ltt));
  }
  if (input.ltq !== undefined) {
    parts.push(encodeVarintField(3, input.ltq));
  }
  if (input.cp !== undefined) {
    parts.push(encodeFixed64Field(4, input.cp));
  }
  return concat(parts);
}

export function encodeFeed(ltpc?: Uint8Array): Uint8Array {
  if (!ltpc) {
    return new Uint8Array(0);
  }
  return encodeLenField(1, ltpc);
}

function encodeFeedsEntry(key: string, feed: Uint8Array): Uint8Array {
  return concat([encodeStringField(1, key), encodeLenField(2, feed)]);
}

export function encodeFeedResponse(input: {
  type?: number;
  feeds?: Record<string, Uint8Array>;
  currentTs?: number;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeVarintField(1, input.type ?? 1));
  for (const [key, feed] of Object.entries(input.feeds ?? {})) {
    parts.push(encodeLenField(2, encodeFeedsEntry(key, feed)));
  }
  if (input.currentTs !== undefined) {
    parts.push(encodeVarintField(3, input.currentTs));
  }
  return concat(parts);
}
