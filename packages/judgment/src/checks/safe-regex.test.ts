import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileSafeRegex, MAX_SUBJECT_CHARS } from './safe-regex.js';

const compile = (p: string) => {
  const r = compileSafeRegex(p);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('safe regex: supported subset agrees with RegExp', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['abc', ['abc'], ['ab', 'abcd', '']],
    ['a|b|cd', ['a', 'b', 'cd'], ['c', 'ab']],
    ['a*', ['', 'a', 'aaaa'], ['b']],
    ['a+b?', ['a', 'ab', 'aaab'], ['b', 'abb']],
    ['a{2,3}', ['aa', 'aaa'], ['a', 'aaaa']],
    ['a{2}', ['aa'], ['a', 'aaa']],
    ['a{2,}', ['aa', 'aaaaa'], ['a']],
    ['[a-c]+', ['abc', 'cab'], ['abd', '']],
    ['[^a-c]', ['d', 'Z'], ['a', '']],
    ['\\d{3}-\\d{4}', ['555-1234'], ['5551234', '55-1234']],
    ['\\w+@\\w+\\.com', ['ada@x.com'], ['ada@x.org']],
    ['\\s', [' ', '\t'], ['a']],
    ['(ab)+', ['ab', 'abab'], ['aba', '']],
    ['(?:ab|cd)*e', ['e', 'abcde', 'cdabe'], ['abc']],
    ['.', ['a', '.'], ['', 'ab']],
    ['\\.', ['.'], ['a']],
    ['[.\\-]', ['.', '-'], ['a']],
    ['^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', ['a@b.co'], ['a@b', 'a b@c.d', '@b.c']],
    ['é+', ['éé'], ['e']],
    ['[\\d\\s]+', ['1 2'], ['a']],
    ['a+?', ['aa'], ['']],
  ];
  for (const [pattern, yes, no] of cases) {
    it(`/${pattern}/`, () => {
      const m = compile(pattern);
      const native = new RegExp(`^(?:${pattern.replace(/^\^/, '').replace(/\$$/, '')})$`, 'u');
      for (const s of yes) {
        expect(m.fullMatch(s), `${pattern} should match ${JSON.stringify(s)}`).toBe(true);
        expect(native.test(s)).toBe(true);
      }
      for (const s of no) {
        expect(m.fullMatch(s), `${pattern} should not match ${JSON.stringify(s)}`).toBe(false);
        expect(native.test(s)).toBe(false);
      }
    });
  }

  it('search() finds a match anywhere, like RegExp.test', () => {
    const m = compile('b+c');
    expect(m.search('aabbbcd')).toBe(true);
    expect(m.search('aabd')).toBe(false);
  });

  it('agrees with RegExp on random strings over a small alphabet (property)', () => {
    const patterns = ['(a|b)*c', 'a+b*', '(ab|a)+', '[ab]{1,3}c?', '(a*)*b'];
    fc.assert(
      fc.property(fc.constantFrom(...patterns), fc.string({ unit: fc.constantFrom('a', 'b', 'c'), maxLength: 12 }), (p, s) => {
        expect(compile(p).fullMatch(s)).toBe(new RegExp(`^(?:${p})$`, 'u').test(s));
        expect(compile(p).search(s)).toBe(new RegExp(p, 'u').test(s));
      }),
      { seed: 8, numRuns: 500 },
    );
  });
});

describe('safe regex: refusals', () => {
  const refused = [
    ['(a)\\1', /backreference/],
    ['(?=a)a', /lookaround/],
    ['(?!a)b', /lookaround/],
    ['(?<=a)b', /lookaround/],
    ['(?<name>a)', /group/],
    ['a{1,5000}', /repeat/],
    ['a{3,2}', /repeat/],
    ['[z-a]', /range/],
    ['(ab', /\)/],
    ['ab)', /\)/],
    ['*a', /quantifier/],
    ['a**', /quantifier/],
    ['\\p{L}', /escape/],
    ['a^b', /anchor/],
    ['a$b', /anchor/],
    ['\\b', /escape/],
    ['((a{1,100}){1,100}){1,100}', /too large/],
  ] as const;
  for (const [pattern, why] of refused) {
    it(`refuses /${pattern}/`, () => {
      const r = compileSafeRegex(pattern);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    });
  }

  it('refuses patterns longer than 200 characters', () => expect(compileSafeRegex('a'.repeat(201)).ok).toBe(false));

  it('does not match subjects longer than the cap', () => {
    expect(compile('a*').fullMatch('a'.repeat(MAX_SUBJECT_CHARS + 1))).toBe(false);
    expect(compile('a*').fullMatch('a'.repeat(MAX_SUBJECT_CHARS))).toBe(true);
  });
});

describe('safe regex: linear time on catastrophic patterns', () => {
  for (const p of ['(a+)+$', '(a|a)*b', '(a*)*b', '(a|aa)+c', '(\\w+\\s?)+$']) {
    it(`/${p}/ on a 4000-char adversarial subject`, () => {
      const m = compile(p);
      const started = performance.now();
      m.fullMatch(`${'a'.repeat(4000)}!`);
      m.search(`${'a'.repeat(4000)}!`);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  }
});
