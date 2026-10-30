import { describe, expect, it } from 'vitest';
import { parsePragmas } from './pragma.js';

const ok = (src: string) => {
  const r = parsePragmas(src);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const bad = (src: string) => {
  const r = parsePragmas(src);
  if (r.ok) throw new Error(`expected an error for ${JSON.stringify(src)}`);
  return r.error;
};

describe('first-line pragmas', () => {
  it('reads all four pragmas from the first line', () => {
    expect(ok('# @settlement sim @judges recorded @mode guaranteed_on_decision @seed 7\nname: x\n')).toEqual({
      settlement: 'sim',
      judges: 'recorded',
      mode: 'guaranteed_on_decision',
      seed: 7,
    });
  });

  it('fills defaults for pragmas the line leaves out', () => {
    expect(ok('# @seed 3\nname: x')).toEqual({ settlement: 'sim', judges: 'recorded', mode: 'guaranteed_on_decision', seed: 3 });
    expect(ok('# @judges fake @settlement local')).toMatchObject({ judges: 'fake', settlement: 'local', seed: 0 });
  });

  it('only reads the first line', () => {
    expect(ok('# @seed 1\n# @seed 2\n')).toMatchObject({ seed: 1 });
  });

  it('requires the first line to be a pragma comment', () => {
    expect(bad('name: x\n# @seed 1')).toMatch(/first line/);
    expect(bad('')).toMatch(/first line/);
    expect(bad('# just a comment')).toMatch(/first line/);
  });

  it('rejects unknown pragmas, bad values, duplicates and missing values', () => {
    expect(bad('# @color red')).toMatch(/unknown pragma @color/);
    expect(bad('# @settlement mainnet')).toMatch(/@settlement.*mainnet/);
    expect(bad('# @judges live2')).toMatch(/@judges/);
    expect(bad('# @mode instant')).toMatch(/@mode/);
    expect(bad('# @seed -1')).toMatch(/@seed/);
    expect(bad('# @seed 1.5')).toMatch(/@seed/);
    expect(bad('# @seed 99999999999999999999')).toMatch(/@seed/);
    expect(bad('# @seed 1 @seed 2')).toMatch(/twice/);
    expect(bad('# @seed')).toMatch(/@seed needs a value/);
    expect(bad('# @seed 1 stray')).toMatch(/stray/);
  });
});
