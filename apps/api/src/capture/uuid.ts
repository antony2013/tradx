import { randomBytes } from 'node:crypto';

const MAX_TIMESTAMP = 281474976710655n;

export function uuidv7(
  timestamp = Date.now(),
  randomSource: (size: number) => Uint8Array = randomBytes,
): string {
  let value = BigInt(timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    value > MAX_TIMESTAMP
  ) {
    throw new Error('UUIDv7 timestamp must be a non-negative safe integer');
  }

  const bytes = randomSource(16);
  if (bytes.length !== 16) {
    throw new Error('UUIDv7 random source must return 16 bytes');
  }

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn) as number;
    value >>= 8n;
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
