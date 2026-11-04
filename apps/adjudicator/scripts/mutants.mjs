// Mutation sweep for the adjudicator service: break one rule at a time, run the adjudicator
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
  ['keys', 'accept without the key for the buyer', A('service.ts'), "if (outcome === 'accept' && judged.contentKey && task.firstOutcome !== 'reject') unsigned.keyForBuyer =", 'if (false) unsigned.keyForBuyer ='],
  ['keys', 'an overturned reject carries the key to the refunded buyer (T-211)', A('service.ts'), " && task.firstOutcome !== 'reject') unsigned.keyForBuyer =", ') unsigned.keyForBuyer ='],
  ['keys', 'the accept after an escalation loses its key (T-211)', A('service.ts'), "task.firstOutcome !== 'reject') unsigned.keyForBuyer =", "task.firstOutcome === 'accept') unsigned.keyForBuyer ="],
  ['keys', 'escalate without the appeal key', A('service.ts'), '      unsigned.encryptedKeys = wrapKeyForRecipients(', '      void wrapKeyForRecipients('],
  ['keys', 'buyer key not validated before judging', A('service.ts'), '      buyerKey = decodePublicKey(commitment.buyerEncryptionPublicKey);', '      buyerKey = new Uint8Array(32);'],
  ['record', 'record hash covers the signature', A('service.ts'), '  delete body.signature;\n', ''],
  ['decision', 'role not in the decision nonce', A('service.ts'), '`holdback.decision-nonce.v1:${role}:${attempt}`', '`holdback.decision-nonce.v1:${attempt}`'],
  ['acceptance', 'acceptance reserves no bond', A('service.ts'), '      bondReserved: c.price,', "      bondReserved: { ...c.price, amount: '0' } as typeof c.price,"],
  ['consent', 'appeal windows not checked (T-211)', A('service.ts'), '      if (c.timing[field] > max) {', '      if (false) {'],
  ['consent', 'fee not checked', A('service.ts'), 'if (BigInt(fee.amount) < BigInt(min.amount)) return problem(', 'if (false) return problem('],
  ['consent', 'fee token not checked (T-211)', A('service.ts'), 'if (fee.token !== min.token) return problem(', 'if (false) return problem('],
  ['consent', 'free bond not checked (T-211)', A('service.ts'), '    if (cover >= BigInt(c.price.amount)) return null;', '    if (true) return null;'],
  ['consent', 'fallback and appeal turns not checked (T-211)', A('service.ts'), "    if (role !== 'primary') {\n      const mine", "    if (false) {\n      const mine"],
  ['consent', 'a takeover it declines is triggered anyway (T-211)', A('service.ts'), '      if (declined) report.refused.push(', '      if (false) report.refused.push('],
  ['consent', 'offers accepted whatever their terms (T-211)', A('service.ts'), '    const terms = this.#termsMismatch(c) ?? this.#windowsProblem(c) ?? this.#feeProblem(c);\n    if (terms) return err(terms);', '    const terms = null;\n    if (terms) return err(terms);'],
  ['consent', "the fallback's windows not checked at its turn (T-211)", A('service.ts'), "(role === 'fallback' ? this.#windowsProblem(c) : null)", 'null'],
  ['consent', 'the appeal turn checks the windows (T-211, red team F2)', A('service.ts'), "(role === 'fallback' ? this.#windowsProblem(c) : null)", 'this.#windowsProblem(c)'],
  ['consent', 'the appeal turn is gated on free bond (T-211, red team F1)', A('service.ts'), "cover: role === 'fallback' && cached !== 'escalate'", "cover: cached !== 'escalate'"],
  ['consent', 'it reneges on a deal it accepted as primary (T-211, red team F6)', A('service.ts'), 'const consented = mine(commitment.adjudication.adjudicator) ||', 'const consented = false ||'],
  ['consent', 'its takeover check reneges on a deal it accepted as primary (T-211, red team F6)', A('service.ts'), '{ consented: c.adjudication.adjudicator.toLowerCase() === this.address, cover: true }', '{ consented: false, cover: true }'],
  ['consent', 'it dodges the appeal of its own fallback decision (T-211, review nit 2)', A('service.ts'), " || (role === 'appeal' && mine(task.firstDecider)) ||", ' ||'],
  ['consent', 'a named fallback that never acted is exempt at the appeal (T-211, review round 3)', A('service.ts'), "(role === 'appeal' && mine(task.firstDecider))", "(role === 'appeal' && mine(commitment.adjudication.fallbackAdjudicator))"],
  ['consent', 'a retry of a judged escalation needs cover (T-211, review round 3)', A('service.ts'), "cover: role === 'fallback' && cached !== 'escalate'", "cover: role === 'fallback'"],
  ['consent', 'cover not read again after the panel (T-211, red team F7)', A('service.ts'), "    if (task.role === 'fallback' && judged.outcome !== 'escalate') {\n      const short", "    if (false) {\n      const short"],
  ['consent', 'an escalation needs cover after the panel (T-211, review nit 3)', A('service.ts'), "if (task.role === 'fallback' && judged.outcome !== 'escalate') {", "if (task.role === 'fallback') {"],
  ['consent', 'its own appeals never expired (T-211, red team F3)', A('service.ts'), '      if ((await port.expireAppeal(id)).ok) report.expired.push(id);', '      void id;'],
  ['consent', 'a throwing expiry aborts the pass (T-211, review nit 4)', A('service.ts'), '      } catch (e) {\n        report.refused.push({ commitmentId: id, problem: problem(', '      } catch (e) {\n        throw e; report.refused.push({ commitmentId: id, problem: problem('],
  ['consent', "a task's terms not checked against the commitment ID (T-211, red team H5, J2)", A('service.ts'), '    const mismatch = this.#termsMismatch(commitment);\n    if (mismatch) return err(mismatch);', '    const mismatch = null;\n    if (mismatch) return err(mismatch);'],
  ['consent', "an offer's terms not checked against the commitment ID (T-211)", A('service.ts'), 'const terms = this.#termsMismatch(c) ?? this.#windowsProblem(c)', 'const terms = this.#windowsProblem(c)'],
  ['consent', 'the wrong-key re-release gated on the fee (T-211, red team J3)', A('service.ts'), " || (role === 'appeal' && mine(task.firstDecider)) || rerelease;", " || (role === 'appeal' && mine(task.firstDecider));"],
  // The SimChain adapter (end-to-end tests in simchain-adapter.test.ts).
  ['simchain adapter', 'primary given no released envelope', A('simchain-adapter.ts'), "task.role === 'primary' ? released : []", '[]'],
  ['simchain adapter', 'fallback given no released key', A('simchain-adapter.ts'), "const releasedKey = task.role === 'primary' ? undefined : released.at(-1);", 'const releasedKey = undefined;'],
  ['simchain adapter', 'fallback takes no task after the takeover', A('simchain-adapter.ts'), "else if (s.kind === 'FallbackJudging' && lc(fallbackAdjudicator) === me)", 'else if (false)'],
  ['simchain adapter', 'offers not found in the event log', A('simchain-adapter.ts'), "if (e.type === 'commitment.offered') {", "if (e.type === 'commitment.agreed') {"],
  ['simchain adapter', 'acceptance submitted as a decision', A('simchain-adapter.ts'), "{ kind: 'adjudicator_accept', message }", "{ kind: 'decide', message: message as never }"],
  ['simchain adapter', "SimChain's takeover reservation not counted in the cover (T-211)", A('simchain-adapter.ts'), '    return (free > 0n ? free : 0n) + held;', '    return free > 0n ? free : 0n;'],
  ['simchain adapter', 'SimChain counts only the reservation after the takeover (T-211, red team K5)', A('simchain-adapter.ts'), '      free = pooled;\n      held = chain.reservations', "      free = s?.kind === 'Delivered' ? pooled : 0n;\n      held = chain.reservations"],
  ['simchain adapter', 'appeal expiries of another decider (T-211)', A('simchain-adapter.ts'), ' || lc(s.via.decision.adjudicator) !== lc(adjudicator)) return false;', ') return false;'],
  ['simchain adapter', 'appeal expiry before appealBy (T-211)', A('simchain-adapter.ts'), "(a.kind === 'none' && now >= Date.parse(a.appealBy))", "(a.kind === 'none')"],
  ['simchain adapter', 'open appeal expiry before appealDecideBy (T-211, review nit 1)', A('simchain-adapter.ts'), "(a.kind === 'open' && now >= Date.parse(a.appealDecideBy))", "(a.kind === 'open')"],
  ['simchain adapter', "the contract's freeOf not read (T-211)", A('simchain-adapter.ts'), '      free = await chain.freeBond(a);', '      free = pooled;'],
  ['simchain adapter', 'a takeover past fallbackBy still due (T-211)', A('simchain-adapter.ts'), ' && now < Date.parse(c.timing.fallbackBy))', ')'],
  ['simchain adapter', "the contract path ignores the primary's own reservation (T-211)", A('simchain-adapter.ts'), "s?.kind === 'Delivered' || s?.kind === 'FallbackJudging'\n          ? c.adjudication.adjudicator", "s?.kind === 'Delivered' || s?.kind === 'FallbackJudging'\n          ? null"],
  ['simchain adapter', "the contract path ignores the first decider's reservation (T-211)", A('simchain-adapter.ts'), '            ? s.via.decision.adjudicator', '            ? null'],
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
