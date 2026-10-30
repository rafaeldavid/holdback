import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalKeccak } from './canonical.js';

// Expected strings follow RFC 8785 (JCS): keys sorted by UTF-16 code units, ECMAScript number
// serialization, minimal string escaping. The two RFC vectors are from its sections 3.2.2 and 3.2.3.
const vectors: Array<[name: string, input: unknown, canonical: string]> = [
  ['key ordering', { b: 2, a: 1, c: 3 }, '{"a":1,"b":2,"c":3}'],
  ['nested objects', { z: { y: [3, { b: null, a: true }], x: {} }, a: [] }, '{"a":[],"z":{"x":{},"y":[3,{"a":true,"b":null}]}}'],
  [
    'numbers (RFC 8785 3.2.2)',
    [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001, -0, 3.0, 1e21, 1e-7],
    '[333333333.3333333,1e+30,4.5,0.002,1e-27,0,3,1e+21,1e-7]',
  ],
  [
    'string escaping (RFC 8785 3.2.2)',
    { string: '\u20ac$\u000F\u000aA\'\u0042\u0022\u005c\u005c\u0022/' },
    '{"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  ],
  [
    'unicode key ordering (RFC 8785 3.2.3)',
    { '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\ufb33': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '\ud83d\ude00': 'Emoji: Grinning Face', '\u0080': 'Control', '\u00f6': 'Latin Small Letter O With Diaeresis' },
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
  ],
  ['literals', [null, true, false, ''], '[null,true,false,""]'],
];

// keccak256 of the canonical UTF-8 bytes, pinned so any change to canonicalization or hashing is visible.
const pinnedHashes: Record<string, string> = {
  'key ordering': '0x0822ab840ad717a17afbedcbc389b4c648199045b947af2f4c0f7759fb145211',
  'nested objects': '0xcb7ae558c7b666918c10166f8bf2065fb988cc220060120edb357bcdb279a17e',
  'numbers (RFC 8785 3.2.2)': '0xc2bf2862b4e52d52103ab62d9c91020d6b02d3f10ded31f57149fc6ec2fcbaf4',
  'unicode key ordering (RFC 8785 3.2.3)': '0xa0a138a7404c34122e9e872cd2a11429272c1ad2a592c0c8c47cf059164bb78f',
};

describe('canonicalJson', () => {
  it.each(vectors)('%s', (_name, input, canonical) => {
    expect(canonicalJson(input)).toBe(canonical);
  });

  it('ignores insertion order', () => {
    expect(canonicalJson({ a: 1, b: { d: 1, c: 2 } })).toBe(canonicalJson({ b: { c: 2, d: 1 }, a: 1 }));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', { a: undefined }],
    ['a bigint', 1n],
    ['a function', { f: () => 1 }],
    ['a lone surrogate', '\ud800'],
  ])('refuses %s', (_name, input) => {
    expect(() => canonicalJson(input)).toThrow(TypeError);
  });
});

describe('canonicalKeccak', () => {
  it.each(vectors)('hashes the canonical UTF-8 bytes: %s', (_name, input, canonical) => {
    expect(canonicalKeccak(input)).toBe(keccak256(stringToBytes(canonical)));
  });

  it.each(Object.entries(pinnedHashes))('matches the pinned hash: %s', (name, pinned) => {
    const vector = vectors.find(([n]) => n === name);
    expect(vector).toBeDefined();
    expect(canonicalKeccak(vector?.[1])).toBe(pinned);
  });

  it('agrees with the well-known keccak256 of the empty string', () => {
    expect(keccak256(stringToBytes(''))).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });
});
