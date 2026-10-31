// Mutation sweep for the adjudicator service (T-009): break one rule at a time, run the adjudicator
// tests, and require that some test fails. Restores every file, even on error.
// Usage (from the repo root): node apps/adjudicator/scripts/mutants.mjs [filter]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const at = (p) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const A = (f) => `apps/adjudicator/src/${f}`;

/** [group, description, file (from the repo root), find, replace] */
const MUTANTS = [
  ['demo deliverable', 'seeded sample never used (the demo CSV escalates)', 'packages/judgment/src/prompt.ts', 'const seeded = records ? sampleCsv(records, max, input.sample!.seed) : null;', 'const seeded = null as ReturnType<typeof sampleCsv>;'],
  ['demo deliverable', 'service passes no sample seed', A('service.ts'), '        sampleSeed: plan.value.sampleSeed,\n', ''],
  ['key on takeover', 'fallback reads its envelope from the delivery', A('service.ts'), "role === 'primary' ? task.delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === this.address) : task.releasedKey", 'task.releasedKey ?? task.delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === this.address)'],
  ['key on takeover', 'released-key recipient not checked', A('service.ts'), 'if (!envelope || envelope.recipient.toLowerCase() !== this.address) {', 'if (!envelope) {'],
  ['seed for the role', 'fallback uses a self-chosen seed', A('service.ts'), 'seed: panelSeed(id, role, attempt, value),', 'seed: this.seedFor(id),'],
  ['seed for the role', 'appeal round not strictly after the escalation', A('randomness.ts'), "return role === 'fallback' ? r : r + 1;", 'return r;'],
  ['seed for the role', 'unpublished beacon round used', A('randomness.ts'), '      if (simRoundAt(now()) < round) return null;\n', ''],
  ['seed for the role', 'primary seed not bound to the commitment', A('service.ts'), "stringToBytes('holdback.primary-seed.v1'), toBytes(commitmentId)]", "stringToBytes('holdback.primary-seed.v1')]"],
  ['policy binding', 'bound policy hash not checked', A('policy.ts'), 'if (h !== boundPolicyHash) return bad(', 'if (false) return bad('],
  ['policy binding', 'template hash not checked', A('policy.ts'), 'if (policy.promptTemplateHash !== PROMPT_TEMPLATE_HASH) return bad(', 'if (false) return bad('],
  ['policy binding', 'appeal template hash not checked', A('policy.ts'), 'if (policy.appealPromptTemplateHash !== APPEAL_PROMPT_TEMPLATE_HASH) return bad(', 'if (false) return bad('],
  ['policy binding', 'registry hash not checked', A('service.ts'), 'if (this.#cfg.registry.hash !== commitment.adjudication.registryHash) {', 'if (false) {'],
  ['no re-roll', 'judged record not cached', A('service.ts'), '      this.#judged.set(key, judged);\n', ''],
  ['no re-roll', 'appeal registration not checked before judging', A('service.ts'), "    if (role !== 'appeal') {\n      const next", "    if (false) {\n      const next"],
  ['no re-roll', 'publication failure not caught', A('service.ts'), '      } catch (e) {\n        return err(problem(', '      } catch (e) {\n        throw e; return err(problem('],
  ['appeal', 'appeal judged with the first-instance template', A('service.ts'), "template: appeal ? 'appeal' : 'first-instance',", "template: 'first-instance',"],
  ['appeal', 'appeal panel uses the first-instance size', A('service.ts'), 'const size = appeal ? policy.appealPanelSize : policy.panelSize;', 'const size = policy.panelSize;'],
  ['appeal', 'appeal panel uses the first-instance family minimum', A('service.ts'), 'const minFamilies = appeal ? Math.max(policy.minFamilies, Math.min(policy.minFamiliesAppeal, familiesAvailable)) : policy.minFamilies;', 'const minFamilies = policy.minFamilies;'],
  ['appeal', 'appeal panel uses the first-instance minValid', A('service.ts'), 'minValid: appeal ? policy.minValidAppeal : policy.minValid,', 'minValid: policy.minValid,'],
  ['appeal', 'key ground waves through a reject', A('service.ts'), "task.appealGround === 'missing-or-wrong-key' && task.firstOutcome === 'accept'", "task.appealGround === 'missing-or-wrong-key'"],
  ['appeal', 'inconclusive party appeal does not leave the first decision standing', A('service.ts'), "if (appeal && outcome === 'escalate') outcome = task.firstOutcome ?? null;", "if (appeal && outcome === 'escalate') outcome = null;"],
  ['intake', 'store mismatch decided as reject', A('service.ts'), "      return err(problem('invalid_state', 'the stored ciphertext does not match the delivery; retrying later'));", "      return ok('reject');"],
  ['intake', 'unopenable key escalates after publishing', A('service.ts'), "      return err(problem('invalid_state', `this adjudicator cannot open its key", "      return ok('escalate'); err(problem('invalid_state', `this adjudicator cannot open its key"],
  ['keys', 'accept without the key for the buyer', A('service.ts'), "if (outcome === 'accept' && judged.contentKey) unsigned.keyForBuyer =", 'if (false) unsigned.keyForBuyer ='],
  ['keys', 'escalate without the appeal key', A('service.ts'), '      unsigned.encryptedKeys = wrapKeyForRecipients(', '      void wrapKeyForRecipients('],
  ['keys', 'buyer key not validated before judging', A('service.ts'), '      buyerKey = decodePublicKey(commitment.buyerEncryptionPublicKey);', '      buyerKey = new Uint8Array(32);'],
  ['record', 'record hash covers the signature', A('service.ts'), '  delete body.signature;\n', ''],
  ['decision', 'role not in the decision nonce', A('service.ts'), '`holdback.decision-nonce.v1:${role}:${attempt}`', '`holdback.decision-nonce.v1:${attempt}`'],
  ['acceptance', 'acceptance reserves no bond', A('service.ts'), '      bondReserved: c.price,', "      bondReserved: { ...c.price, amount: '0' } as typeof c.price,"],
];

function runTests() {
  const r = spawnSync('pnpm', ['vitest', 'run', 'apps/adjudicator'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const out = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const m = /^\s*Tests\s+(\d+) failed/m.exec(out);
  const files = /^\s*Test Files\s+(\d+) failed/m.exec(out);
  return { failed: r.status !== 0, failedCount: m ? `${m[1]} tests` : files ? `${files[1]} files` : 'suite' };
}

// A journal of the file under mutation, written before each mutation and removed after its restore,
// so a sweep killed mid-run (where finally never runs) is undone by the next start.
const JOURNAL = `${root}reports/mutant-inflight.json`;
if (existsSync(JOURNAL)) {
  const j = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  writeFileSync(j.path, j.original);
  rmSync(JOURNAL);
  console.error(`restored ${j.path} from a killed sweep`);
}
mkdirSync(`${root}reports`, { recursive: true });

const filter = process.argv[2];
const rows = [];
for (const [group, desc, file, find, replace] of MUTANTS.filter(([g, d]) => !filter || `${g}: ${d}`.includes(filter))) {
  const path = at(file);
  const original = readFileSync(path, 'utf8');
  const count = original.split(find).length - 1;
  if (count !== 1) {
    rows.push({ group, desc, result: `NOT APPLIED (${count} matches)` });
    continue;
  }
  writeFileSync(JOURNAL, JSON.stringify({ path, original }));
  try {
    writeFileSync(path, original.replace(find, () => replace));
    if (file.startsWith('packages/')) spawnSync('pnpm', ['tsc', '-b', 'packages/judgment'], { cwd: root });
    const r = runTests();
    rows.push({ group, desc, result: r.failed ? `killed (${r.failedCount} failed)` : 'SURVIVED' });
  } finally {
    writeFileSync(path, original);
    rmSync(JOURNAL);
    if (file.startsWith('packages/')) spawnSync('pnpm', ['tsc', '-b', 'packages/judgment'], { cwd: root });
  }
  console.error(`${rows.at(-1).result.padEnd(28)} ${group}: ${desc}`);
}

console.log('| Group | Mutant | Result |\n| --- | --- | --- |');
for (const r of rows) console.log(`| ${r.group} | ${r.desc} | ${r.result} |`);
const bad = rows.filter((r) => !r.result.startsWith('killed'));
console.log(`\n${rows.length} mutants, ${rows.length - bad.length} killed, ${bad.length} survived or not applied.`);
process.exit(bad.length ? 1 : 0);
