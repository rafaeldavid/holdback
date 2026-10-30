// Proves the money lint rule in eslint.config.js fires, so the "no floats in money" check is real.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../../', import.meta.url).pathname;
const eslint = new ESLint({ cwd: root });

async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const inMoney = 'packages/core/src/money/probe.ts';

describe('money lint rule', () => {
  it.each([
    ['a number type', 'export const f = (x: number) => x;\n'],
    ['a fractional literal', 'export const x = 0.5;\n'],
    ['an exponent literal', 'export const x = 1e18;\n'],
    ['Number()', "export const x = Number('1');\n"],
    ['parseFloat()', "export const x = parseFloat('1');\n"],
    ['Math', 'export const x = Math.floor;\n'],
    ['unary plus', "export const x = +'1';\n"],
    ['new Number()', "export const x = new Number('1');\n"],
    ['toFixed()', 'export const f = (x: bigint) => x.toLocaleString().toFixed;\n'],
  ])('rejects %s in money code', async (_name, code) => {
    expect(await messages(code, inMoney)).not.toEqual([]);
  });

  it('accepts bigint arithmetic and integer literals in money code', async () => {
    const code = 'export const f = (a: bigint, b: bigint): bigint => a + b * 2n;\nexport const sign: -1 | 0 | 1 = 0;\n';
    expect(await messages(code, inMoney)).toEqual([]);
  });

  it('does not apply outside money code', async () => {
    expect(await messages('export const x: number = 0.5;\n', 'packages/core/src/probe.ts')).toEqual([]);
  });
});
