import { createHash } from 'node:crypto';
import type { Sha256 } from '../types.js';

const SHA256_ID = /^sha256:[0-9a-f]{64}$/;

/** `sha256:<lowercase hex>` of the bytes, the common.schema.json Sha256 form. Bytes are not interpreted. */
export function sha256(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** True only for the exact `sha256:` + 64 lowercase hex form. */
export function isSha256(value: unknown): value is Sha256 {
  return typeof value === 'string' && SHA256_ID.test(value);
}
