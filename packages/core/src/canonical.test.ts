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

// keccak256 of the canonical UTF-8 bytes, pinned for every vector so any change to canonicalization or
// hashing is visible.
const pinnedHashes: Record<string, string> = {
  'key ordering': '0x0822ab840ad717a17afbedcbc389b4c648199045b947af2f4c0f7759fb145211',
  'nested objects': '0xcb7ae558c7b666918c10166f8bf2065fb988cc220060120edb357bcdb279a17e',
  'numbers (RFC 8785 3.2.2)': '0xc2bf2862b4e52d52103ab62d9c91020d6b02d3f10ded31f57149fc6ec2fcbaf4',
  'string escaping (RFC 8785 3.2.2)': '0xd10abcd2d1c6bb99d3efe8d784f308b8d25f004fd4cd798beafd5d8f002d6679',
  'unicode key ordering (RFC 8785 3.2.3)': '0xa0a138a7404c34122e9e872cd2a11429272c1ad2a592c0c8c47cf059164bb78f',
  literals: '0x606019345fac9ba3eba823cf793a70a172533141ccafe9ca73d32e6edf4e88a4',
};

describe('canonicalJson', () => {
  it.each(vectors)('%s', (_name, input, canonical) => {
    expect(canonicalJson(input)).toBe(canonical);
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
  it.each(vectors)('matches the pinned hash: %s', (name, input) => {
    expect(canonicalKeccak(input)).toBe(pinnedHashes[name]);
  });
});
