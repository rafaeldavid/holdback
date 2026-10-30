// A small regular-expression engine for patterns that come from commitments. Patterns are parties'
// input, so they never reach the JavaScript RegExp engine, which backtracks and can take exponential
// time ("(a+)+$"). This engine compiles a closed subset to a Thompson NFA and simulates it with state
// sets: time is O(subject length × pattern states) for every pattern it accepts.
//
// Supported: literals; `.`; classes `[...]` and `[^...]` with ranges; escapes \d \D \w \W \s \S
// \t \n \r \f \v and escaped syntax characters; groups `(...)` and `(?:...)` (no captures are
// reported); alternation `|`; quantifiers * + ? {n} {n,} {n,m}, greedy or lazy (laziness does not
// change whether a string matches); `^` only as the first character and `$` only as the last.
// Refused: backreferences, lookarounds, named groups, word boundaries, Unicode property escapes,
// \u and \x escapes, flags, and patterns whose NFA would exceed MAX_STATES.
import { err, ok, type Result } from '@holdback/core';

export const MAX_PATTERN_CHARS = 200;
export const MAX_REPEAT = 1000;
export const MAX_STATES = 10_000;
/** Longer subjects never match; this bounds the work per cell. */
export const MAX_SUBJECT_CHARS = 10_000;

type Pred = (cp: number) => boolean;
type Node =
  | { t: 'char'; test: Pred }
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'repeat'; node: Node; min: number; max: number };

export interface SafeRegex {
  /** True iff the whole subject matches (anchors implied). */
  fullMatch(subject: string): boolean;
  /** True iff some substring matches, honoring a leading ^ and trailing $ (RegExp.test semantics). */
  search(subject: string): boolean;
}

class PatternError extends Error {}

const range = (lo: number, hi: number): Pred => (cp) => cp >= lo && cp <= hi;
const DIGIT: Pred = range(0x30, 0x39);
const WORD: Pred = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || cp === 0x5f;
const SPACE_SET = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]);
const SPACE: Pred = (cp) => SPACE_SET.has(cp) || (cp >= 0x2000 && cp <= 0x200a);
const LINE_TERMINATORS = new Set([0x0a, 0x0d, 0x2028, 0x2029]);
const DOT: Pred = (cp) => !LINE_TERMINATORS.has(cp);
const not = (p: Pred): Pred => (cp) => !p(cp);
const SYNTAX = new Set([...'^$\\.*+?()[]{}|/-'].map((c) => c.codePointAt(0)!));
const CONTROL: Record<string, number> = { t: 0x09, n: 0x0a, r: 0x0d, f: 0x0c, v: 0x0b };
const CLASS_ESCAPES: Record<string, Pred> = { d: DIGIT, D: not(DIGIT), w: WORD, W: not(WORD), s: SPACE, S: not(SPACE) };

class Parser {
  private i = 0;
  constructor(private readonly cps: number[]) {}

  parse(): Node {
    const node = this.alternation();
    if (this.i < this.cps.length) throw new PatternError(`unexpected ) at ${this.i}`);
    return node;
  }

  private peek(offset = 0): string | undefined {
    const cp = this.cps[this.i + offset];
    return cp === undefined ? undefined : String.fromCodePoint(cp);
  }

  private alternation(): Node {
    const options = [this.sequence()];
    while (this.peek() === '|') {
      this.i++;
      options.push(this.sequence());
    }
    return options.length === 1 ? options[0]! : { t: 'alt', options };
  }

  private sequence(): Node {
    const items: Node[] = [];
    for (let c = this.peek(); c !== undefined && c !== '|' && c !== ')'; c = this.peek()) {
      items.push(this.quantified(this.atom()));
    }
    return { t: 'seq', items };
  }

  private atom(): Node {
    const c = this.peek()!;
    if ('*+?{'.includes(c)) throw new PatternError(`quantifier ${c} has nothing to repeat at ${this.i}`);
    if (c === '}' || c === ']') throw new PatternError(`unbalanced ${c} at ${this.i}`);
    if (c === '^' || c === '$') throw new PatternError(`anchor ${c} is only allowed at the start (^) or end ($) of the pattern`);
    this.i++;
    if (c === '.') return { t: 'char', test: DOT };
    if (c === '\\') return { t: 'char', test: this.escape(false) };
    if (c === '[') return { t: 'char', test: this.charClass() };
    if (c === '(') {
      if (this.peek() === '?') {
        const next = this.peek(1);
        if (next === ':') this.i += 2;
        else if (next === '=' || next === '!' || (next === '<' && (this.peek(2) === '=' || this.peek(2) === '!'))) {
          throw new PatternError('lookaround assertions are not supported');
        } else throw new PatternError('only (...) and (?:...) groups are supported');
      }
      const inner = this.alternation();
      if (this.peek() !== ')') throw new PatternError('missing )');
      this.i++;
      return inner;
    }
    return { t: 'char', test: ((cp) => (x: number) => x === cp)(c.codePointAt(0)!) };
  }

  /** Called after the backslash. Inside a class only single-character escapes and \d\w\s are allowed. */
  private escape(inClass: boolean): Pred {
    const c = this.peek();
    if (c === undefined) throw new PatternError('pattern ends with \\');
    this.i++;
    if (/[1-9]/.test(c) || c === 'k') throw new PatternError('backreferences are not supported');
    if (c in CLASS_ESCAPES) return CLASS_ESCAPES[c]!;
    if (c in CONTROL) return ((cp) => (x: number) => x === cp)(CONTROL[c]!);
    const cp = c.codePointAt(0)!;
    if (SYNTAX.has(cp) || (inClass && c === '-')) return (x) => x === cp;
    throw new PatternError(`escape \\${c} is not supported`);
  }

  private charClass(): Pred {
    let negate = false;
    if (this.peek() === '^') {
      negate = true;
      this.i++;
    }
    const preds: Pred[] = [];
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw new PatternError('missing ]');
      if (c === ']') {
        this.i++;
        break;
      }
      const lo = this.classAtom();
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        this.i++;
        const hi = this.classAtom();
        if (typeof lo !== 'number' || typeof hi !== 'number') throw new PatternError('a class escape cannot bound a range');
        if (lo > hi) throw new PatternError('character class range out of order');
        preds.push(range(lo, hi));
      } else {
        preds.push(typeof lo === 'number' ? (x) => x === lo : lo);
      }
    }
    const any: Pred = (cp) => preds.some((p) => p(cp));
    return negate ? not(any) : any;
  }

  /** A code point, or a predicate for \d \w \s and their negations. */
  private classAtom(): number | Pred {
    const c = this.peek()!;
    this.i++;
    if (c !== '\\') return c.codePointAt(0)!;
    const e = this.peek();
    if (e !== undefined && e in CLASS_ESCAPES) {
      this.i++;
      return CLASS_ESCAPES[e]!;
    }
    if (e !== undefined && e in CONTROL) {
      this.i++;
      return CONTROL[e]!;
    }
    if (e !== undefined && (SYNTAX.has(e.codePointAt(0)!) || e === '-')) {
      this.i++;
      return e.codePointAt(0)!;
    }
    // Every supported class escape is handled above; escape() throws the specific refusal.
    this.escape(true);
    throw new PatternError('unsupported class escape');
  }

  private quantified(node: Node): Node {
    const c = this.peek();
    let min: number;
    let max: number;
    if (c === '*') [min, max] = [0, Infinity];
    else if (c === '+') [min, max] = [1, Infinity];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') {
      const m = /^\{(\d{1,6})(,(\d{0,6}))?\}/.exec(String.fromCodePoint(...this.cps.slice(this.i, this.i + 16)));
      if (!m) throw new PatternError(`malformed repeat {...} at ${this.i}`);
      min = Number.parseInt(m[1]!, 10);
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number.parseInt(m[3]!, 10);
      if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) throw new PatternError(`repeat bound exceeds ${MAX_REPEAT}`);
      if (min > max) throw new PatternError('repeat {n,m} with n > m');
      this.i += m[0].length - 1;
    } else return node;
    this.i++;
    if (this.peek() === '?') this.i++; // lazy: same language
    const after = this.peek();
    if (after !== undefined && '*+?{'.includes(after)) throw new PatternError(`quantifier ${after} follows a quantifier at ${this.i}`);
    return { t: 'repeat', node, min, max };
  }
}

// NFA: char states consume one code point; split states are epsilon branches; MATCH accepts.
type State = { k: 'char'; test: Pred; out: number } | { k: 'split'; a: number; b: number } | { k: 'match' };

class Compiler {
  readonly states: State[] = [{ k: 'match' }];

  private push(s: State): number {
    if (this.states.length >= MAX_STATES) throw new PatternError(`pattern too large (over ${MAX_STATES} states)`);
    this.states.push(s);
    return this.states.length - 1;
  }

  /** Compiles `node` so that on success it continues at `next`; returns the entry state. */
  build(node: Node, next: number): number {
    switch (node.t) {
      case 'char':
        return this.push({ k: 'char', test: node.test, out: next });
      case 'seq':
        return node.items.reduceRight((cont, item) => this.build(item, cont), next);
      case 'alt': {
        const entries = node.options.map((o) => this.build(o, next));
        return entries.reduceRight((rest, e) => this.push({ k: 'split', a: e, b: rest }));
      }
      case 'repeat': {
        let tail: number;
        if (node.max === Infinity) {
          const loop = this.push({ k: 'split', a: -1, b: next });
          (this.states[loop] as { a: number }).a = this.build(node.node, loop);
          tail = loop;
        } else {
          tail = next;
          for (let i = node.min; i < node.max; i++) tail = this.push({ k: 'split', a: this.build(node.node, tail), b: next });
        }
        for (let i = 0; i < node.min; i++) tail = this.build(node.node, tail);
        return tail;
      }
    }
  }
}

function simulate(states: State[], start: number, cps: number[], anchoredStart: boolean, anchoredEnd: boolean): boolean {
  const mark = new Int32Array(states.length).fill(-1);
  let gen = 0;
  let current: number[] = [];
  const add = (list: number[], s: number) => {
    const stack = [s];
    while (stack.length) {
      const x = stack.pop()!;
      if (mark[x] === gen) continue;
      mark[x] = gen;
      const st = states[x]!;
      if (st.k === 'split') stack.push(st.b, st.a);
      else list.push(x);
    }
  };
  add(current, start);
  const accepts = (list: number[]) => list.some((x) => states[x]!.k === 'match');
  for (const cp of cps) {
    if (!anchoredEnd && accepts(current)) return true;
    gen++;
    const next: number[] = [];
    for (const x of current) {
      const st = states[x]!;
      if (st.k === 'char' && st.test(cp)) add(next, st.out);
    }
    if (!anchoredStart) add(next, start);
    current = next;
    if (current.length === 0 && anchoredStart) return false;
  }
  return accepts(current);
}

export function compileSafeRegex(pattern: string): Result<SafeRegex, string> {
  if (pattern.length > MAX_PATTERN_CHARS) return err(`pattern longer than ${MAX_PATTERN_CHARS} characters`);
  let cps = [...pattern].map((c) => c.codePointAt(0)!);
  let anchoredStart = false;
  let anchoredEnd = false;
  if (cps[0] === 0x5e) {
    anchoredStart = true;
    cps = cps.slice(1);
  }
  if (cps.at(-1) === 0x24) {
    let backslashes = 0;
    for (let i = cps.length - 2; i >= 0 && cps[i] === 0x5c; i--) backslashes++;
    if (backslashes % 2 === 0) {
      anchoredEnd = true;
      cps = cps.slice(0, -1);
    }
  }
  try {
    const ast = new Parser(cps).parse();
    const c = new Compiler();
    const start = c.build(ast, 0);
    const { states } = c;
    const run = (subject: string, full: boolean) => {
      const chars = [...subject];
      if (chars.length > MAX_SUBJECT_CHARS) return false;
      return simulate(states, start, chars.map((ch) => ch.codePointAt(0)!), full || anchoredStart, full || anchoredEnd);
    };
    return ok({ fullMatch: (s) => run(s, true), search: (s) => run(s, false) });
  } catch (e) {
    if (e instanceof PatternError) return err(e.message);
    throw e;
  }
}
