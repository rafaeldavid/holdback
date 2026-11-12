// Which product files still use a feature the phase-one contracts cut (T-354).
//
// ADR-0031 cuts five features from the phase-one contracts: any-token support (SC-1), Permit2 funding (SC-2),
// payouts to a third address (SC-3), the on-chain record of an unfunded offer's expiry (SC-6), and party appeals
// with the bond vault (SC-7). The contract refinement plan, section 7b (kept privately, docs/private-materials.md),
// asks every product component to follow. This test scans the tracked files for the identifiers of those features
// and compares the files it finds with the known remainder in `cut-feature-alignment.known.json`, each mapped to
// the component and the package that will fix it.
//
// - A file that newly uses a cut identifier fails the test.
// - A listed file that no longer uses one fails it too, so the list only shrinks.
// - The alignment is done when the known list is empty.
//
// Progress, per component, cut, identifier and file (a failing run prints it on its own):
//   pnpm exec vitest run tests/cut-feature-alignment.test.ts --silent=false
// Rewrite the known list after a fix, or after a merge brings in other files:
//   pnpm exec vitest run tests/cut-feature-alignment.test.ts -u
// Review the known list's diff before committing it: only removals are progress. The scan reads the files git
// tracks, so a new file counts once it is added.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

type Cut = 'SC-1' | 'SC-2' | 'SC-3' | 'SC-6' | 'SC-7';

/** Each cut with the ADR-0031 section that says what leaves. */
const CUTS: Record<Cut, string> = {
  'SC-1': 'ADR-0031 §2 and the appendix (docs/neutrality.md, residual 1): one settlement token per deployment',
  'SC-2': 'ADR-0031 §3: ERC-3009 funding only; the Permit2 path leaves',
  'SC-3': 'ADR-0031 §4 and §10: a mutual settlement pays the buyer and the seller only; `Paid` leaves',
  'SC-6': 'ADR-0031 §7: no on-chain record of an unfunded offer\'s expiry; `expireOffer` leaves',
  'SC-7': 'ADR-0031 §8 and §10: no party appeals and no bonds; `HoldbackBonds` leaves',
};

interface Identifier {
  cut: Cut;
  /** The name as the source spells it. */
  name: string;
  /** Matches a use of the name; a word match unless a note says why it is narrower. */
  pattern: RegExp;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const word = (cut: Cut, name: string): Identifier => ({ cut, name, pattern: new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`) });
const named = (cut: Cut, name: string, pattern: RegExp): Identifier => ({ cut, name, pattern });

/**
 * The identifiers of every cut feature: names that exist only for it. Each was found in the source of this branch
 * (contracts/src, the EVM adapter, the operator, spec/schemas) before it was listed.
 *
 * Left out on purpose, because they stay in phase one (ADR-0031 §8, "What stays", and "Signed types and schemas"):
 * `appealAdjudicator`, the role `appeal`, `appealDecideSec` and `escalate` (escalation stays); `appealWindowSec`,
 * `appealGround` and `bondReserved` (still in the signed types); `appealState` (reads `none`); `offer.expired`,
 * `JobExpired` and `escrowState` `Expired` (the operators' record); the `permit2` value of
 * `FundingAuthorization.scheme` (kept for the full protocol); `appealPanelSize` (the appeal adjudicator's panel
 * still decides escalations). Left out because ADR-0031 does not name them: the rulebook fields `appealFee`,
 * `appealBondRateBps` and `bondNoticePeriodMinSec` (club rules, not contract features). Left out because the word is
 * too common to match precisely: the vault's `deposit`, `withdraw`, `encumber`, `release` and `slash`, and the
 * contract's `Stage.Expired`; the names beside them in each feature (`HoldbackBonds`, `bondOf`, `expireOffer`)
 * find the same files.
 */
export const IDENTIFIERS: readonly Identifier[] = [
  // SC-1, ADR-0031 appendix: the residual-1 mitigation the cut falsifies.
  named('SC-1', 'any ERC-20', /\bany ERC-20\b/),

  // SC-2, ADR-0031 §3: the constructor argument, the immutable and its getter, the collector contract.
  // `Permit2` also matches `Permit2PaymentCollector` and prose; lowercase `permit2` is the kept scheme value.
  named('SC-2', 'Permit2', /\bPermit2/),
  word('SC-2', 'permit2Collector'),
  word('SC-2', 'PERMIT2_COLLECTOR'),

  // SC-3, ADR-0031 §4 and §10: the `Paid` event, matched as an event name only (a quoted name, a declaration or
  // an emit), never the English word; and a rulebook that lets payouts go to any address.
  named('SC-3', 'Paid (event)', /(['"])Paid\1|\bevent Paid\b|\bemit Paid\b/),
  named('SC-3', 'payoutsTo: any', /payoutsTo['"]?\s*:\s*['"]?any\b/),

  // SC-6, ADR-0031 §7: the contract function, the operators' trigger route and their timeout kind.
  word('SC-6', 'expireOffer'),
  word('SC-6', 'expire-offer'),
  word('SC-6', 'expire_offer'),
  // The scenario fixtures' step that expires an unfunded offer.
  named('SC-6', '- expire: (fixture step)', /^\s*-\s*expire:/),

  // SC-7, ADR-0031 §8: HoldbackRules' appeal functions, storage, constants and error.
  word('SC-7', 'fileAppeal'),
  word('SC-7', 'expireAppeal'),
  word('SC-7', '_appealDecision'),
  word('SC-7', '_releaseBonds'),
  word('SC-7', 'AppealState'),
  word('SC-7', 'KEY_APPEAL'),
  word('SC-7', 'F_BY_FALLBACK'),
  word('SC-7', 'WrongAppealState'),
  // SC-7, ADR-0031 §8: HoldbackTypes' appeal type.
  word('SC-7', 'APPEAL_TYPEHASH'),
  word('SC-7', 'appealHash'),
  // SC-7, ADR-0031 §8: HoldbackBonds, its functions, storage and errors.
  word('SC-7', 'HoldbackBonds'),
  word('SC-7', 'takeAppealBond'),
  word('SC-7', 'payAppealBond'),
  word('SC-7', 'freeOf'),
  word('SC-7', 'bondOf'),
  word('SC-7', 'encumberedOf'),
  word('SC-7', 'appealBondOf'),
  word('SC-7', 'NotRules'),
  word('SC-7', 'InsufficientFreeBond'),
  word('SC-7', 'AppealBondTooLarge'),
  word('SC-7', 'AppealBondExists'),
  // SC-7, ADR-0031 §10: the nine events that leave.
  word('SC-7', 'AppealFiled'),
  word('SC-7', 'AppealClosed'),
  word('SC-7', 'BondDeposited'),
  word('SC-7', 'BondWithdrawn'),
  word('SC-7', 'BondEncumbered'),
  word('SC-7', 'BondReleased'),
  word('SC-7', 'AppealBondHeld'),
  word('SC-7', 'AppealBondPaid'),
  word('SC-7', 'BondSlashed'),
  // SC-7, ADR-0031 "Signed types and schemas": the Appeal message, the appeal and bond event kinds, `BondMovement`.
  word('SC-7', 'appeal.schema.json'),
  word('SC-7', 'parseAppeal'),
  named('SC-7', 'appellant', /\bappellant/),
  word('SC-7', 'appeal.filed'),
  word('SC-7', 'appeal.decided'),
  word('SC-7', 'appeal.expired'),
  word('SC-7', 'bond.paid'),
  word('SC-7', 'bond.deposited'),
  word('SC-7', 'bond.withdrawn'),
  word('SC-7', 'bond.slashed'),
  word('SC-7', 'BondMovement'),
  // SC-7, ADR-0031 appendix (docs/api.md, site/llms.txt): the appeal route, its submission kind, and the appeal
  // window's trigger and timeout kind. The submission kind is matched as `kind: 'appeal'`; the adjudicator role
  // `appeal`, which stays, is spelled `role`.
  named('SC-7', 'prepare/appeal', /\bprepare\/appeal\b/),
  named('SC-7', "kind: 'appeal'", /\bkind['"]?\s*:\s*['"]appeal['"]/),
  word('SC-7', 'appeal-expiry'),
  word('SC-7', 'appeal_expiry'),
  // SC-7, ADR-0031 §8 open points 5 and 6: the scenario fixtures' party-appeal step, and the bond gate's refusal
  // (`coverage_exceeded`, the 100% coverage rule of ADR-0007 and ADR-0030), which has no vault to read.
  named('SC-7', '- appeal: (fixture step)', /^\s*-\s*appeal:/),
  word('SC-7', 'coverage_exceeded'),
];

/**
 * Tracked paths the scan leaves out, each with its reason. A path is out when it equals an entry or starts with an
 * entry that ends in `/`.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {
  'contracts/': "the lane's own gates check the contracts (plan section 6), and its side-by-side harness names the old contract on purpose; vendored code (contracts/lib) is here too, the only vendored code in the tree",
  'packages/settlement/sim/': 'SimChain keeps the full feature set as the full protocol\'s reference (ADR-0031 §8, open point 5)',
  'docs/decisions/': 'ADRs are history (ADR-0031 appendix: records do not change)',
  'docs/decisions-today.md': 'the decision log is history',
  'docs/tasks/': 'task files are history',
  'docs/reviews/': 'reviews are history',
  'docs/research/': 'research is history',
  'reports/': 'tracked reports are records of past runs',
  'examples/e2e-scenarios-appeal.ts': "the Sepolia round's party-appeal scenarios (3c, 6, 7) and their helpers, which run on SimChain only: on a chain each stops at simChainOnly (ADR-0031 §8; T-374). One chain path uses it: scenario 5b calls `appeal` to show the phase-one operators refuse it",
  'examples/e2e-scenarios-appeal.test.ts': 'the SimChain runs of those scenarios',
  'tests/cut-feature-alignment.test.ts': 'this test lists the identifiers',
  'tests/cut-feature-alignment.known.json': 'the known list names the files, not the features',
};

/**
 * The SimChain-only fixtures (`LOCAL_EXCLUSIONS` in packages/testkit/src/runner.ts) keep the full feature set, so
 * their scenario files and recordings are left out. The list is read from the runner, so a fixture moved there
 * leaves the scan with it.
 */
function simchainOnlyFixtures(): string[] {
  const runner = readFileSync(join(root, 'packages/testkit/src/runner.ts'), 'utf8');
  const block = /LOCAL_EXCLUSIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(runner);
  if (!block) throw new Error('LOCAL_EXCLUSIONS not found in packages/testkit/src/runner.ts');
  return [...block[1]!.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]!);
}

/**
 * A use is marked, and not counted, when its line or one of the three lines above it says the feature is
 * "not in phase one" or "SimChain only". That is how a doc or a schema that keeps the full protocol's text says so
 * (ADR-0031 appendix, "The rule for every row"). No tracked file outside the excluded paths carries a mark yet.
 */
const MARK = /not in (the )?phase[- ]one|simchain[- ]only/i;
const MARK_REACH = 3;

/**
 * Word matches that are not uses of a cut feature, each with its reason, by path and identifier name. Add an entry
 * here rather than loosening a pattern.
 */
export const ALLOWED: ReadonlyArray<{ path: string; name: string; reason: string }> = [
  {
    path: 'packages/judgment/src/prompt.ts',
    name: 'appellant',
    reason: 'a comment on what an appeal panel is not told; the plan (7b) finds the judgment pipeline takes nothing from the contracts, and its appeal panel still decides escalations',
  },
  // ADR-0031 §7 removes the contract's record of an unfunded offer's expiry, not the operators' own: the phase-one adapter
  // still steps `expire_offer` by its clock and logs `offer.expired` with no transaction (evm-settlement.ts, case
  // 'expire_offer'). The testkit's trigger name and the fixtures' `- expire:` step drive that record (T-374).
  {
    path: 'packages/testkit/src/stub-settlement.ts',
    name: 'expire_offer',
    reason: "the fixtures' `expire` step maps to the operators' clock expiry, which phase one keeps with no transaction",
  },
  {
    path: 'packages/testkit/src/scenario.test.ts',
    name: '- expire: (fixture step)',
    reason: "the parser's test of the `expire` step, the operators' clock expiry that phase one keeps",
  },
  {
    path: 'tests/metrics/fixtures/deal-once.events.json',
    name: 'appeal.expired',
    reason: 'an event log recorded from the deployed domain-0.7 world, read as recorded; JSON carries no mark (T-374)',
  },
];

/** The plan's component table (section 7b): which component a path belongs to, and who owns its alignment. */
interface Component {
  name: string;
  owner: string;
  match: (path: string) => boolean;
}
const under = (...prefixes: string[]) => (p: string) => prefixes.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x));
const PINNED_CLIENT = /^examples\/(try|agent|verify|deployments|sign)(\.test)?\.ts$/;

/** First match wins. Owners as the plan names them; "open" means no package owns the row yet. */
export const COMPONENTS: readonly Component[] = [
  { name: 'spec/', owner: 'R6 part 2 (A); R6c-1 (G)', match: under('spec/') },
  { name: 'packages/core', owner: 'R6 part 1, R5, R6c-1, R8', match: under('packages/core/') },
  { name: 'packages/settlement/evm', owner: 'R6 part 2, R5, R6c-1, R8', match: under('packages/settlement/evm/') },
  { name: 'packages/settlement (the port)', owner: 'open (not in the plan\'s table)', match: under('packages/settlement/') },
  { name: 'packages/sdk, packages/testkit', owner: 'open', match: under('packages/sdk/', 'packages/testkit/') },
  { name: 'packages/judgment', owner: 'none needed (plan); a find here is a surprise', match: under('packages/judgment/') },
  { name: 'apps/operator', owner: 'R6 part 2, R5, R6c-2', match: under('apps/operator/') },
  { name: 'apps/demo-cloud', owner: 'R6 part 2, R6c-2; the cutover at R12', match: under('apps/demo-cloud/') },
  { name: 'apps/adjudicator', owner: 'R6 part 2, R8', match: under('apps/adjudicator/') },
  { name: 'apps/test-agents', owner: 'R6c-2', match: under('apps/test-agents/') },
  { name: 'apps/demo', owner: 'open', match: under('apps/demo/') },
  { name: 'examples/e2e-* (the Sepolia round)', owner: 'open', match: (p) => p.startsWith('examples/e2e-') },
  { name: 'examples/ pinned client', owner: 'R6c-3 for G; open for the rest', match: (p) => PINNED_CLIENT.test(p) },
  { name: 'examples/ (adapters, signer, record)', owner: 'R6c-3, package 3', match: under('examples/') },
  { name: 'fixtures/', owner: 'R6c-1, R6 part 1', match: under('fixtures/') },
  { name: 'formal/', owner: 'R6 part 1 (A); open for the rest', match: under('formal/') },
  { name: 'site/', owner: 'R6c-3, package 5', match: under('site/') },
  { name: 'docs/audit', owner: 'R12', match: under('docs/audit/') },
  { name: 'docs/ and the root docs', owner: 'R6 part 2 (A); open for the rest', match: (p) => p.startsWith('docs/') || !p.includes('/') },
  { name: 'tools/, scripts/, tests/', owner: 'open', match: under('tools/', 'scripts/', 'tests/') },
  { name: 'other (not in the plan\'s table)', owner: 'open', match: () => true },
];

const componentOf = (path: string) => COMPONENTS.find((c) => c.match(path))!;

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function excluded(path: string, fixtures: readonly string[]): boolean {
  if (Object.keys(EXCLUDED).some((x) => (x.endsWith('/') ? path.startsWith(x) : path === x))) return true;
  return fixtures.some((f) => path.startsWith(`fixtures/scenarios/${f}.`) || path.startsWith(`fixtures/recordings/${f}/`));
}

interface Find {
  path: string;
  /** Uses per identifier name. */
  uses: Map<string, number>;
}

/** Every tracked file outside the exclusions that uses at least one cut identifier, with its uses. */
export function scan(): Find[] {
  const fixtures = simchainOnlyFixtures();
  const finds: Find[] = [];
  for (const path of tracked()) {
    if (excluded(path, fixtures)) continue;
    const full = join(root, path);
    if (!statSync(full, { throwIfNoEntry: false })?.isFile()) continue; // a submodule or a deleted file
    const bytes = readFileSync(full);
    if (bytes.includes(0)) continue; // binary
    const lines = bytes.toString('utf8').split('\n');
    const uses = new Map<string, number>();
    lines.forEach((line, i) => {
      for (const id of IDENTIFIERS) {
        if (!id.pattern.test(line)) continue;
        if (lines.slice(Math.max(0, i - MARK_REACH), i + 1).some((l) => MARK.test(l))) continue;
        if (ALLOWED.some((a) => a.path === path && a.name === id.name)) continue;
        uses.set(id.name, (uses.get(id.name) ?? 0) + 1);
      }
    });
    if (uses.size > 0) finds.push({ path, uses });
  }
  return finds.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The counts per component and per cut, as printed. */
export function report(finds: readonly Find[]): string {
  const cutOf = new Map(IDENTIFIERS.map((id) => [id.name, id.cut]));
  const out: string[] = [`${finds.length} files outside the exclusions still use a feature phase one cut (ADR-0031).`, '', 'Per component (files, owner):'];
  for (const c of COMPONENTS) {
    const n = finds.filter((f) => componentOf(f.path) === c).length;
    if (n > 0) out.push(`  ${String(n).padStart(4)}  ${c.name}  [${c.owner}]`);
  }
  out.push('', 'Per cut (files, uses):');
  for (const cut of Object.keys(CUTS) as Cut[]) {
    const files = finds.filter((f) => [...f.uses.keys()].some((n) => cutOf.get(n) === cut));
    const uses = finds.reduce((s, f) => s + [...f.uses].filter(([n]) => cutOf.get(n) === cut).reduce((t, [, k]) => t + k, 0), 0);
    out.push(`  ${cut}  ${String(files.length).padStart(4)} files  ${String(uses).padStart(5)} uses  ${CUTS[cut]}`);
  }
  out.push('', 'Per identifier (files):');
  for (const id of IDENTIFIERS) {
    const n = finds.filter((f) => f.uses.has(id.name)).length;
    out.push(`  ${id.cut}  ${String(n).padStart(4)}  ${id.name}`);
  }
  out.push('', 'Per file (identifier × uses):');
  for (const f of finds) out.push(`  ${f.path}: ${[...f.uses].map(([n, k]) => `${n} ×${k}`).join(', ')}`);
  return out.join('\n');
}

/** The known list's text: each file with its component and owner, sorted, so a fix shows as a removed line. */
export function knownList(finds: readonly Find[]): string {
  const files: Record<string, string> = {};
  for (const f of finds) {
    const c = componentOf(f.path);
    files[f.path] = `${c.name} [${c.owner}]`;
  }
  return `${JSON.stringify({ files }, null, 2)}\n`;
}

describe('the product follows the phase-one contracts (ADR-0031; T-354)', () => {
  it('every identifier names its cut, and every cut its ADR-0031 section', () => {
    for (const id of IDENTIFIERS) expect(CUTS[id.cut], id.name).toMatch(/^ADR-0031 §/);
    expect(new Set(IDENTIFIERS.map((id) => id.name)).size).toBe(IDENTIFIERS.length);
  });

  it('the files that use a cut feature equal the known list exactly', async () => {
    const finds = scan();
    console.log(report(finds));
    await expect(knownList(finds), 'the known list is stale: a file was fixed or newly uses a cut feature').toMatchFileSnapshot(
      './cut-feature-alignment.known.json',
    );
  });
});
