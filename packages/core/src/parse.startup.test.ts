// A Cloudflare Worker may generate code (Ajv compiles schemas with `new Function`) only at startup, never while
// serving a request. T-029 shipped a lazy compile that passed every Node test and failed the live demo with
// "Code generation from strings disallowed". This test pins the rule: after core is imported, every parser runs
// with code generation switched off. Since T-233 the validators are compiled ahead of time, so the import itself
// generates no code either; apps/demo-cloud/src/startup.test.ts checks that for the whole Worker.
import { afterEach, describe, expect, it } from 'vitest';
import { parsers } from './parse.js';

const RealFunction = globalThis.Function;
afterEach(() => {
  globalThis.Function = RealFunction;
});

describe('the parsers generate no code', () => {
  it('runs every parser with code generation disallowed', () => {
    const forbidden = function () {
      throw new EvalError('Code generation from strings disallowed for this context');
    } as unknown as FunctionConstructor;
    globalThis.Function = forbidden;
    for (const [name, parse] of Object.entries(parsers)) {
      expect(() => parse({}), name).not.toThrow();
    }
  });
});
