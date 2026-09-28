import type { DecodeIssue, DecodedFeedResponse, FeedResponse } from './types';

export class ProtobufDecodeError extends Error {
  readonly code: string;

  constructor(message: string, code = 'MALFORMED_PROTOBUF') {
    super(message);
    this.name = 'ProtobufDecodeError';
    this.code = code;
  }
}

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readVarint(): bigint {
    let value = 0n;
    let shift = 0n;

    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte();
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return value;
      }
      shift += 7n;
    }

    throw new ProtobufDecodeError('Varint exceeds 64 bits');
  }

  readVarintNumber(): number {
    return Number(this.readVarint());
  }

  readVarintString(): string {
    return this.readVarint().toString();
  }

  readFixed64(): number {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readBytes(): Uint8Array {
    const length = Number(this.readVarint());
    this.ensure(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes());
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const tag = this.readVarint();
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNumber <= 0) {
      throw new ProtobufDecodeError('Invalid protobuf field number');
    }
    return { fieldNumber, wireType };
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.readVarint();
        return;
      case 1:
        this.ensure(8);
        this.offset += 8;
        return;
      case 2:
        this.readBytes();
        return;
      case 5:
        this.ensure(4);
        this.offset += 4;
        return;
      default:
        throw new ProtobufDecodeError(`Unsupported protobuf wire type ${wireType}`);
    }
  }

  private readByte(): number {
    this.ensure(1);
    const value = this.bytes[this.offset] as number;
    this.offset += 1;
    return value;
  }

  private ensure(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new ProtobufDecodeError('Unexpected end of protobuf message');
    }
  }
}

function parseFields(
  bytes: Uint8Array,
  visit: (fieldNumber: number, wireType: number, reader: Reader) => void,
): void {
  const reader = new Reader(bytes);
  while (reader.remaining > 0) {
    const tag = reader.readTag();
    visit(tag.fieldNumber, tag.wireType, reader);
  }
}

function requireWireType(
  actual: number,
  expected: number,
  fieldNumber: number,
): void {
  if (actual !== expected) {
    throw new ProtobufDecodeError(
      `Unexpected wire type ${actual} for field ${fieldNumber}`,
    );
  }
}

function decodeDoubleValue(bytes: Uint8Array): { iep?: number } {
  const result: { iep?: number } = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 1, fieldNumber);
      result.iep = reader.readFixed64();
      return;
    }
    reader.skip(wireType);
  });
  return result;
}

function decodeLtpc(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 1, fieldNumber);
      result.ltp = reader.readFixed64();
    } else if (fieldNumber === 2) {
      requireWireType(wireType, 0, fieldNumber);
      result.ltt = reader.readVarintString();
    } else if (fieldNumber === 3) {
      requireWireType(wireType, 0, fieldNumber);
      result.ltq = reader.readVarintString();
    } else if (fieldNumber === 4) {
      requireWireType(wireType, 1, fieldNumber);
      result.cp = reader.readFixed64();
    } else if (fieldNumber === 5) {
      requireWireType(wireType, 2, fieldNumber);
      result.iep = decodeDoubleValue(reader.readBytes()).iep;
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeQuote(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 0, fieldNumber);
      result.bidQ = reader.readVarintString();
    } else if (fieldNumber === 2) {
      requireWireType(wireType, 1, fieldNumber);
      result.bidP = reader.readFixed64();
    } else if (fieldNumber === 3) {
      requireWireType(wireType, 0, fieldNumber);
      result.askQ = reader.readVarintString();
    } else if (fieldNumber === 4) {
      requireWireType(wireType, 1, fieldNumber);
      result.askP = reader.readFixed64();
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeMarketLevel(bytes: Uint8Array): Record<string, unknown> {
  const quotes: unknown[] = [];
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      quotes.push(decodeQuote(reader.readBytes()));
      return;
    }
    reader.skip(wireType);
  });
  return { bidAskQuote: quotes };
}

function decodeOhlc(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 2, fieldNumber);
      result.interval = reader.readString();
    } else if (fieldNumber >= 2 && fieldNumber <= 5) {
      requireWireType(wireType, 1, fieldNumber);
      const names = ['open', 'high', 'low', 'close'];
      result[names[fieldNumber - 2] as string] = reader.readFixed64();
    } else if (fieldNumber === 6) {
      requireWireType(wireType, 0, fieldNumber);
      result.vol = reader.readVarintString();
    } else if (fieldNumber === 7) {
      requireWireType(wireType, 0, fieldNumber);
      result.ts = reader.readVarintString();
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeMarketOhlc(bytes: Uint8Array): Record<string, unknown> {
  const ohlc: unknown[] = [];
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      ohlc.push(decodeOhlc(reader.readBytes()));
      return;
    }
    reader.skip(wireType);
  });
  return { ohlc };
}

function decodeOptionGreeks(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber >= 1 && fieldNumber <= 5) {
      requireWireType(wireType, 1, fieldNumber);
      const names = ['delta', 'theta', 'gamma', 'vega', 'rho'];
      result[names[fieldNumber - 1] as string] = reader.readFixed64();
      return;
    }
    reader.skip(wireType);
  });
  return result;
}

function decodeStatusInfo(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 2, fieldNumber);
      result.status = reader.readString();
    } else if (fieldNumber === 2) {
      requireWireType(wireType, 0, fieldNumber);
      result.updatedTime = reader.readVarintString();
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeMarketFullFeed(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.ltpc = decodeLtpc(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.marketLevel = decodeMarketLevel(reader.readBytes());
    } else if (fieldNumber === 3 && wireType === 2) {
      result.optionGreeks = decodeOptionGreeks(reader.readBytes());
    } else if (fieldNumber === 4 && wireType === 2) {
      result.marketOHLC = decodeMarketOhlc(reader.readBytes());
    } else if (fieldNumber === 5) {
      requireWireType(wireType, 1, fieldNumber);
      result.atp = reader.readFixed64();
    } else if (fieldNumber === 6) {
      requireWireType(wireType, 0, fieldNumber);
      result.vtt = reader.readVarintString();
    } else if (fieldNumber === 7 || fieldNumber === 8) {
      requireWireType(wireType, 1, fieldNumber);
      result[fieldNumber === 7 ? 'oi' : 'iv'] = reader.readFixed64();
    } else if (fieldNumber >= 9 && fieldNumber <= 12) {
      requireWireType(wireType, 1, fieldNumber);
      const names = ['tbq', 'tsq', 'iep', 'rp'];
      result[names[fieldNumber - 9] as string] = reader.readFixed64();
    } else if (fieldNumber >= 13 && fieldNumber <= 15) {
      requireWireType(wireType, 0, fieldNumber);
      const names = ['ieq', 'iiqTotal', 'iiqM'];
      result[names[fieldNumber - 13] as string] = reader.readVarintString();
    } else if (fieldNumber === 16) {
      requireWireType(wireType, 0, fieldNumber);
      result.casEligible = reader.readVarintNumber() !== 0;
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeIndexFullFeed(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.ltpc = decodeLtpc(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.marketOHLC = decodeMarketOhlc(reader.readBytes());
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeFullFeed(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.marketFF = decodeMarketFullFeed(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.indexFF = decodeIndexFullFeed(reader.readBytes());
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeFirstLevelWithGreeks(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.ltpc = decodeLtpc(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.firstDepth = decodeQuote(reader.readBytes());
    } else if (fieldNumber === 3 && wireType === 2) {
      result.optionGreeks = decodeOptionGreeks(reader.readBytes());
    } else if (fieldNumber === 4) {
      requireWireType(wireType, 0, fieldNumber);
      result.vtt = reader.readVarintString();
    } else if (fieldNumber === 5 || fieldNumber === 6) {
      requireWireType(wireType, 1, fieldNumber);
      result[fieldNumber === 5 ? 'oi' : 'iv'] = reader.readFixed64();
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeFeed(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.ltpc = decodeLtpc(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.fullFeed = decodeFullFeed(reader.readBytes());
    } else if (fieldNumber === 3 && wireType === 2) {
      result.firstLevelWithGreeks = decodeFirstLevelWithGreeks(
        reader.readBytes(),
      );
    } else if (fieldNumber === 4) {
      requireWireType(wireType, 0, fieldNumber);
      result.requestMode = reader.readVarintNumber();
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeStringEnumMap(
  bytes: Uint8Array,
): Record<string, number> {
  const result: Record<string, number> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber !== 2 || wireType !== 2) {
      reader.skip(wireType);
      return;
    }
    const entryBytes = reader.readBytes();
    let key: string | undefined;
    let value: number | undefined;
    parseFields(entryBytes, (entryField, entryWire, entryReader) => {
      if (entryField === 1 && entryWire === 2) {
        key = entryReader.readString();
      } else if (entryField === 2 && entryWire === 0) {
        value = entryReader.readVarintNumber();
      } else {
        entryReader.skip(entryWire);
      }
    });
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function decodeStatusMap(
  bytes: Uint8Array,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber !== 2 || wireType !== 2) {
      reader.skip(wireType);
      return;
    }
    const entryBytes = reader.readBytes();
    let key: string | undefined;
    let value: Record<string, unknown> | undefined;
    parseFields(entryBytes, (entryField, entryWire, entryReader) => {
      if (entryField === 1 && entryWire === 2) {
        key = entryReader.readString();
      } else if (entryField === 2 && entryWire === 2) {
        value = decodeStatusInfo(entryReader.readBytes());
      } else {
        entryReader.skip(entryWire);
      }
    });
    if (key !== undefined && value) {
      result[key] = value;
    }
  });
  return result;
}

function decodeMarketInfo(bytes: Uint8Array): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      result.segmentStatus = decodeStringEnumMap(reader.readBytes());
    } else if (fieldNumber === 2 && wireType === 2) {
      result.casMarketStatus = decodeStatusMap(reader.readBytes());
    } else if (fieldNumber === 3 && wireType === 2) {
      result.preOpenSessionStatus = decodeStatusMap(reader.readBytes());
    } else {
      reader.skip(wireType);
    }
  });
  return result;
}

function decodeFeedMapEntry(
  bytes: Uint8Array,
): { key?: string; value?: Record<string, unknown>; rawValue?: Uint8Array } {
  let key: string | undefined;
  let valueBytes: Uint8Array | undefined;
  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1 && wireType === 2) {
      key = reader.readString();
    } else if (fieldNumber === 2 && wireType === 2) {
      valueBytes = reader.readBytes();
    } else {
      reader.skip(wireType);
    }
  });

  if (!valueBytes) {
    return { key };
  }

  return {
    key,
    value: decodeFeed(valueBytes),
    rawValue: valueBytes,
  };
}

export function decodeFeedResponse(
  input: ArrayBuffer | ArrayBufferView,
): DecodedFeedResponse {
  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const response: FeedResponse = {
    type: 0,
    feeds: {},
  };
  const issues: DecodeIssue[] = [];

  parseFields(bytes, (fieldNumber, wireType, reader) => {
    if (fieldNumber === 1) {
      requireWireType(wireType, 0, fieldNumber);
      response.type = reader.readVarintNumber();
    } else if (fieldNumber === 2 && wireType === 2) {
      const entryBytes = reader.readBytes();
      try {
        const entry = decodeFeedMapEntry(entryBytes);
        if (entry.key && entry.value) {
          response.feeds[entry.key] = entry.value;
        }
      } catch (error) {
        const key = extractMapKey(entryBytes);
        issues.push({
          instrumentKey: key ?? undefined,
          errorCode: 'MALFORMED_INSTRUMENT_FEED',
          errorMessage: error instanceof Error ? error.message : 'Unknown decode error',
          rawPayload: entryBytes,
        });
      }
    } else if (fieldNumber === 3) {
      requireWireType(wireType, 0, fieldNumber);
      response.currentTs = reader.readVarintString();
    } else if (fieldNumber === 4 && wireType === 2) {
      response.marketInfo = decodeMarketInfo(reader.readBytes());
    } else {
      reader.skip(wireType);
    }
  });

  return { response, issues };
}

function extractMapKey(bytes: Uint8Array): string | null {
  try {
    let key: string | undefined;
    parseFields(bytes, (fieldNumber, wireType, reader) => {
      if (fieldNumber === 1 && wireType === 2) {
        key = reader.readString();
      } else {
        reader.skip(wireType);
      }
    });
    return key ?? null;
  } catch {
    return null;
  }
}
