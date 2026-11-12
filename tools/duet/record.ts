// The run's record (T-391): one JSON line per event, in the order things happened. Every string that enters it
// passes through the run's secret list first, so a signing key, an encryption secret or a model API key that some
// output repeated reaches the file only as "[secret]". Long bodies are trimmed past a limit, with their full size kept.
import { appendFileSync, writeFileSync } from 'node:fs';

/** The secrets this run knows: every one is replaced wherever it appears, in the record and in what a model reads. */
export class Secrets {
  private readonly values = new Set<string>();

  add(value: string | undefined): void {
    if (!value || value.length < 12) return; // nothing that short is a key, and it would blank common words
    this.values.add(value);
    // The same key written another way: hex without 0x, lowercase, base64 and base64url of hex bytes.
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
      this.values.add(value.slice(2));
      this.values.add(value.toLowerCase());
      this.values.add(value.slice(2).toLowerCase());
      this.values.add(value.slice(2).toUpperCase());
      this.values.add(`0x${value.slice(2).toUpperCase()}`);
      this.values.add(Buffer.from(value).toString('base64'));
      const bytes = Buffer.from(value.slice(2), 'hex');
      this.values.add(bytes.toString('base64'));
      this.values.add(bytes.toString('base64url'));
    } else if (/^[A-Za-z0-9_-]{40,}={0,2}$/.test(value) || /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value)) {
      const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (bytes.length >= 16) {
        this.values.add(bytes.toString('hex'));
        this.values.add(`0x${bytes.toString('hex')}`);
        this.values.add(bytes.toString('base64'));
        this.values.add(bytes.toString('base64url'));
        this.values.add(bytes.toString('base64').replace(/=+$/, ''));
      }
    }
  }

  get size(): number {
    return this.values.size;
  }

  /** The text with every known secret replaced. Longest first, so a key never leaves a recognisable tail. */
  scrub(text: string): string {
    let out = text;
    for (const v of [...this.values].sort((a, b) => b.length - a.length)) if (out.includes(v)) out = out.split(v).join('[secret]');
    return out;
  }

  /** Whether any known secret appears in the text (the tests' final scan). */
  leaks(text: string): boolean {
    return [...this.values].some((v) => text.includes(v));
  }
}

/** Trims a body for the record, keeping its full size. */
export function trim(text: string, limit: number): { text: string; bytes: number; trimmed: boolean } {
  const bytes = Buffer.byteLength(text);
  return text.length <= limit ? { text, bytes, trimmed: false } : { text: `${text.slice(0, limit)}\n[… ${text.length - limit} more characters, trimmed in the record]`, bytes, trimmed: true };
}

export type Role = 'buyer' | 'seller' | 'runner';

/** One line of the record. `t` is milliseconds since the run started; `at` the wall-clock time. */
export interface Event {
  t: number;
  at: string;
  kind: string;
  role: Role;
  [field: string]: unknown;
}

export class Recorder {
  readonly events: Event[] = [];
  private readonly started = Date.now();

  readonly file: string;
  readonly secrets: Secrets;
  readonly bodyLimit: number;

  constructor(file: string, secrets: Secrets, bodyLimit = 4000) {
    this.file = file;
    this.secrets = secrets;
    this.bodyLimit = bodyLimit;
    writeFileSync(file, '');
  }

  /** Appends one event; every string in it is scrubbed of known secrets first. `atMs`: when it happened, if earlier. */
  add(role: Role, kind: string, fields: Record<string, unknown> = {}, atMs = Date.now()): Event {
    const clean = JSON.parse(this.secrets.scrub(JSON.stringify(fields))) as Record<string, unknown>;
    const e: Event = { t: atMs - this.started, at: new Date(atMs).toISOString(), kind, role, ...clean };
    this.events.push(e);
    appendFileSync(this.file, `${JSON.stringify(e)}\n`);
    return e;
  }

  /** A body for the record: scrubbed, then trimmed past the limit. */
  body(text: string): { text: string; bytes: number; trimmed: boolean } {
    return trim(this.secrets.scrub(text), this.bodyLimit);
  }
}
