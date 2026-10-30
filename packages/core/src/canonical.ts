// RFC 8785 (JSON Canonicalization Scheme) and keccak256 over it, for policyHash, rulebookHash and
// the hashed sub-objects of the commitment terms.
import { keccak256, stringToBytes } from 'viem';
import type { Hex32 } from './types.js';

const LONE_SURROGATE = /\p{Cs}/u;

function str(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new TypeError('canonical JSON: lone surrogate in string');
  // JCS string serialization is exactly ECMAScript JSON.stringify for well-formed strings.
  return JSON.stringify(s);
}

/** Canonical JSON per RFC 8785. Throws TypeError on values JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return str(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonical JSON: non-finite number ${value}`);
    // JCS number serialization is ECMAScript Number.prototype.toString, which JSON.stringify uses (and maps -0 to 0).
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) if (v === undefined) throw new TypeError(`canonical JSON: undefined at key ${k}`);
    // Default sort compares UTF-16 code units, which is the order RFC 8785 requires.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${str(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON: unsupported ${typeof value}`);
}

export function canonicalKeccak(value: unknown): Hex32 {
  return keccak256(stringToBytes(canonicalJson(value)));
}

/** policyHash (ADR-0006): keccak256 of the canonical JSON of the adjudicator's policy object. */
export const policyHash = (policy: object): Hex32 => canonicalKeccak(policy);

/** rulebookHash (club.schema.json): keccak256 of the canonical JSON of the rulebook. */
export const rulebookHash = (rulebook: object): Hex32 => canonicalKeccak(rulebook);
