import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  canonicalJson,
  hashCanonical,
  sha256Hex,
} from '../src/capture/canonical';

describe('canonicalization', () => {
  it('produces identical output regardless of object key order', () => {
    const left = { b: 1, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 1 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('preserves array order', () => {
    expect(canonicalJson({ a: [2, 1] })).not.toBe(
      canonicalJson({ a: [1, 2] }),
    );
    expect(canonicalJson({ a: [1, 2] })).toBe(
      JSON.stringify({ a: [1, 2] }),
    );
  });

  it('does not arbitrarily change numeric values', () => {
    expect(canonicalize(0.1 + 0.2)).toBe(0.30000000000000004);
    expect(canonicalJson({ v: 0.1 + 0.2 })).toBe(
      JSON.stringify({ v: 0.1 + 0.2 }),
    );
  });

  it('sorts keys recursively', () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }] })).toBe(
      '{"z":[{"a":2,"b":1}]}',
    );
  });
});

describe('hashing', () => {
  it('matches the known SHA-256 vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('maps the same canonical payload to the same hash', () => {
    const left = { b: 1, a: [1, 2] };
    const right = { a: [1, 2], b: 1 };

    expect(hashCanonical(left)).toBe(hashCanonical(right));
  });

  it('maps different payloads to different hashes', () => {
    expect(hashCanonical({ a: 1 })).not.toBe(hashCanonical({ a: 2 }));
    expect(hashCanonical({ a: [1, 2] })).not.toBe(
      hashCanonical({ a: [2, 1] }),
    );
  });
});
