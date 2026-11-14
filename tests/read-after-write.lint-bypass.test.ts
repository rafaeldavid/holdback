// T-232: ways past the read-after-write lint rule (eslint.config.js), from the red team of PR 239 (2026-11-06). On
// 5d05e49 every case below passed lint with no message (measured). The review round that reported them (branch
// archive/t-232-review-round-backup, 3515172) never reached main; T-409 ports it. Each one is now reported, except the
// known limits at the end, which a rule that sees only syntax cannot tell from a pinned read.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url).pathname;
const eslint = new ESLint({ cwd: root });

/**
 * The disable comments in `text` that could hide the read rule without naming it and a reason: no rule named, or
 * no-restricted-syntax named with nothing after `--`. The same test as eslint.config.js's `holdback/disable-with-reason`.
 */
function hidingDisables(text: string): string[] {
  const out: string[] = [];
  for (const c of text.matchAll(/\/\/([^\n]*)|\/\*([\s\S]*?)\*\//g)) {
    const body = (c[1] ?? c[2] ?? '').trim();
    const m = /^eslint-disable(?:-next-line|-line)?(?:\s+([\s\S]*))?$/.exec(body);
    if (!m) continue;
    const [rules = '', reason = ''] = (m[1] ?? '').split(/\s-{2,}\s/);
    const names = rules.split(',').map((r) => r.trim()).filter(Boolean);
    if (names.length > 0 && (!names.includes('no-restricted-syntax') || reason.trim())) continue;
    out.push(body.slice(0, 80));
  }
  return out;
}

/** The source files the read rule covers (eslint.config.js): the settlement adapter's and the apps', tests and anvil's world aside. */
function coveredFiles(): string[] {
  const code = (f: string) => /\.(ts|mts|cts)$/.test(f) && !/\.test\.(ts|mts|cts)$/.test(f) && !/(^|\/)node_modules\//.test(f) && !/(^|\/)dist\//.test(f);
  const evm = readdirSync(join(root, 'packages/settlement/evm'), { recursive: true, encoding: 'utf8' })
    .filter((f) => code(f) && !['world.ts', 'testing.ts'].includes(f))
    .map((f) => `packages/settlement/evm/${f}`);
  const apps = readdirSync(join(root, 'apps'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const src = join(root, 'apps', d.name, 'src');
      try {
        return readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(code).map((f) => `apps/${d.name}/src/${f}`);
      } catch {
        return [];
      }
    });
  return [...evm, ...apps];
}

/** The T-232 rule's own errors for `code` at `filePath`. */
async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => /T-232/.test(m.message)).map((m) => m.message);
}

/** Every error (severity 2) any rule reports: a disable comment with no reason should fail some check. */
async function errors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => `${m.ruleId ?? 'eslint'}: ${m.message}`);
}

const inAdapter = 'packages/settlement/evm/probe.ts';
const head = 'declare const chain: any; declare const b: bigint | undefined; declare const name: string; declare function readVia(c: unknown): void;\n';
const read = 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [] });';

describe('read-after-write lint rule: the red team bypasses (T-232)', () => {
  it.each([
    ['an alias of the client', 'const pc = chain.publicClient;\npc.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['a destructured action', 'const { readContract } = chain.publicClient;\nreadContract({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['a read method taken off the client', 'const r = chain.publicClient.readContract;\nr({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['a viem action called with the client', 'import { readContract } from "viem/actions";\nreadContract(chain.publicClient, { address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['a computed member', 'chain.publicClient["readContract"]({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['blockNumber: undefined', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [], blockNumber: undefined });'],
    ['blockNumber nested in the arguments, blockTag latest', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [{ blockNumber: 1n }], blockTag: "latest" });'],
    ['blockNumber only inside a spread', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [], ...(b ? { blockNumber: b } : {}) });'],
    ['a raw eth_call', 'chain.publicClient.request({ method: "eth_call", params: [{ to: "0x", data: "0x" }, "latest"] });'],
    ['a client under another name', 'const rpc = chain.publicClient;\nrpc.getBalance({ address: "0x" });'],
  ])('reports %s', async (_name, code) => {
    expect(await messages(`${head}${code}\n`, inAdapter)).not.toEqual([]);
  });

  it.each([
    ['a bare disable-next-line with no rule and no reason', '// eslint-disable-next-line\n'],
    ['a disable-next-line of the rule with no reason', '// eslint-disable-next-line no-restricted-syntax\n'],
    ['a file-level disable with no reason', '/* eslint-disable */\n'],
    ['a file-level disable of the rule with no reason', '/* eslint-disable no-restricted-syntax */\n'],
  ])('fails lint on %s', async (_name, comment) => {
    const code = `${head}${comment}${read}\n`;
    // The head's own errors (no-explicit-any) are not the point: only an error the comment or the read brings counts.
    const baseline = new Set(await errors(head, inAdapter));
    expect((await errors(code, inAdapter)).filter((m) => !baseline.has(m))).not.toEqual([]);
  });

  // A file whose first character starts `/* eslint-disable */` hides every report a rule can make, its own included, so
  // lint cannot see that one: a scan of the covered files does, with the same test the local rule applies.
  it('passes lint on a file that starts with a bare disable (a known limit of any rule), and the tree scan catches it', async () => {
    expect(await messages(`/* eslint-disable */\n${head}${read}\n`, inAdapter)).toEqual([]);
    expect(hidingDisables(`/* eslint-disable */\n${head}${read}\n`)).toEqual(['eslint-disable']);
  });

  it('no file the rule covers holds a disable comment that could hide a read without naming its rule and a reason', () => {
    const found = coveredFiles().flatMap((f) => hidingDisables(readFileSync(join(root, f), 'utf8')).map((c) => `${f}: ${c}`));
    expect(coveredFiles().length).toBeGreaterThan(20);
    expect(found).toEqual([]);
  });

  it('fails lint on a disable comment that no longer disables anything', async () => {
    const code = `${head}// eslint-disable-next-line no-restricted-syntax -- T-232: a reason, on a pinned read\nchain.publicClient.readContract({ address: "0x", abi: [], functionName: "x", blockNumber: 1n });\n`;
    expect((await errors(code, inAdapter)).some((m) => /Unused eslint-disable directive/.test(m))).toBe(true);
  });

  it("keeps a disable that names the rule and says why, and other rules' disables", async () => {
    const reasoned = `${head}// eslint-disable-next-line no-restricted-syntax -- T-232: read before any write; a constant of the contract.\n${read}\n`;
    const other = `${head}const { a: _a, ...rest } = { a: 1, b: 2 }; // eslint-disable-line @typescript-eslint/no-unused-vars\nexport { rest };\n`;
    const baseline = new Set(await errors(head, inAdapter));
    expect((await errors(reasoned, inAdapter)).filter((m) => !baseline.has(m))).toEqual([]);
    expect((await errors(other, inAdapter)).filter((m) => !baseline.has(m))).toEqual([]);
  });

  it.each(['ts', 'mts', 'cts'])('applies to a .%s file in the apps and the adapter', async (ext) => {
    expect(await messages(`${head}${read}\n`, `apps/demo-cloud/src/probe.${ext}`)).not.toEqual([]);
    expect(await messages(`${head}${read}\n`, `packages/settlement/evm/probe.${ext}`)).not.toEqual([]);
  });

  // Known limits: the rule sees syntax, not types or values. Each passes lint today; a typed reader that
  // hides publicClient would close them, and is out of this PR's scope.
  it.each([
    ['a blockNumber that may be undefined at run time', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [], blockNumber: b });'],
    ['the client passed to a helper that reads', 'readVia(chain.publicClient);'],
    ['a member named by a variable', 'chain.publicClient[name]({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
  ])('does not report %s (a known limit)', async (_name, code) => {
    expect(await messages(`${head}${code}\n`, inAdapter)).toEqual([]);
  });
});
