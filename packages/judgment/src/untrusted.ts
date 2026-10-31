// Deliverable content is untrusted (CLAUDE.md, "Deliverables are untrusted"). It travels through the
// pipeline only inside this class, so a function that takes UntrustedData cannot be handed a plain
// string by accident, and a function that takes a string cannot be handed deliverable content
// without an explicit, greppable reveal().

const REDACTED = '[UntrustedData]';

export class UntrustedData {
  readonly #text: string;

  private constructor(text: string) {
    this.#text = text;
  }

  /** Wraps text that came from a deliverable, a reference file, or anything else a party wrote. */
  static wrap(text: string): UntrustedData {
    return new UntrustedData(text);
  }

  /** True only for real instances (the private field cannot be forged structurally). */
  static is(value: unknown): value is UntrustedData {
    return typeof value === 'object' && value !== null && #text in value;
  }

  /** The content, for evaluators and for the data section of a prompt. Never for an instruction position. */
  reveal(): string {
    return this.#text;
  }

  get length(): number {
    return this.#text.length;
  }

  // Template interpolation, String() and JSON.stringify never expose the content.
  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}
