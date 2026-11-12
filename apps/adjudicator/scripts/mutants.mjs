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
  ['seed for the role', 'fallback uses a self-chosen seed', A('service.ts'), 'seed: panelSeed(id, role, attempt, got.value),', 'seed: this.seedFor(id),'],
  ['seed for the role', 'appeal round not strictly after the escalation', A('randomness.ts'), "return role === 'fallback' ? r : r + 1;", 'return r;'],
  ['seed for the role', 'unpublished beacon round used', A('randomness.ts'), '      if (simRoundAt(now()) < round) return null;\n', ''],
  // T-217: drand quicknet rounds for the fallback and appeal panels (drand.test.ts, service.test.ts).
  ['drand', 'rounds counted on the sim clock whatever the source (T-217)', A('randomness.ts'), 'const r = beaconRoundAt(clock, Math.max(0, t));', 'const r = t;'],
  ['drand', 'the service rounds on the sim clock for a drand commitment (T-217)', A('service.ts'), 'roundFor(role, fixedAt, source.clock)', 'roundFor(role, fixedAt, { genesis: 1, period: 1 })'],
  ['drand', 'the service signs a proof it did not check (T-217)', A('service.ts'), "const proven = source.kind === 'sim' || (source.kind === 'drand-quicknet' && got.signature !== undefined && (await quicknetValue(round, got.signature)) === got.value);", 'const proven = true;'],
  ['drand', 'the Decision drops the proof (T-217)', A('service.ts'), ', ...(got.signature ? { signature: got.signature } : {}) };', ' };'],
  ['drand', 'the BLS pairing not checked (T-217)', A('drand.ts'), '    if (!bls.verifyShortSignature(point, message, groupKey, { DST: QUICKNET_DST })) return null;\n', ''],
  ['drand', 'a non-canonical x (x >= p) accepted (T-217)', A('drand.ts'), " >= P) return null;", ' >= P * 2n) return null;'],
  ['drand', 'the value taken from the relay, not sha256 of the signature (T-217)', A('drand.ts'), 'return value ? { value, signature } :', 'return value ? { value: `0x${String((body as { randomness?: unknown }).randomness)}` as Hex32, signature } :'],
  ["drand", "the answer's round not checked (T-217)", A('drand.ts'), 'if (body.round !== round) return', 'if (false) return'],
  ['drand', 'round 0 asked, which answers the latest round (T-217)', A('drand.ts'), '      if (!Number.isSafeInteger(round) || round < 1) return null;\n', '      if (!Number.isSafeInteger(round)) return null;\n'],
  ['drand', 'a round the clock has not reached is asked (T-217)', A('drand.ts'), ' || round > beaconRoundAt(DRAND_QUICKNET, seconds)) return null;', ') return null;'],
  ['drand', 'no next relay after a refusal (T-217, neutrality.beacon-relay-refuses)', A('drand.ts'), '          continue;\n', '          return null;\n'],
  ['drand', 'a proven round asked again (T-217)', A('drand.ts'), '      if (known) return known;\n', ''],
  ['drand', 'no timeout per relay (T-217)', A('drand.ts'), '{ signal: AbortSignal.timeout(timeoutMs), ', '{ '],
  ['drand', 'another drand chain hash accepted (T-217)', A('drand.ts'), '  if (chainHash !== DRAND_QUICKNET_CHAIN_HASH) {', '  if (false) {'],
  ['drand', 'a missing drand source falls back to the sim beacon (T-217)', A('simchain-adapter.ts'), '(this.#o.drand ?? null)', '(this.#o.drand ?? this.#sim)'],
  ['drand', 'the adapter reads the sim beacon for every commitment (T-217)', A('simchain-adapter.ts'), "return source === 'sim' ? this.#sim :", 'return true ? this.#sim :'],
  ['drand', "testAdjudicator drops its drand source (T-217)", A('test-adjudicator.ts'), '...(o.policy ? { policy: o.policy } : {}), ...(o.drand ? { drand: o.drand } : {}) });', '...(o.policy ? { policy: o.policy } : {}) });'],
  ['seed for the role', 'primary seed not bound to the commitment', A('service.ts'), "stringToBytes('holdback.primary-seed.v1'), toBytes(commitmentId)]", "stringToBytes('holdback.primary-seed.v1')]"],
  ['policy binding', 'bound policy hash not checked', A('policy.ts'), 'if (h !== boundPolicyHash) return bad(', 'if (false) return bad('],
  ['policy binding', 'template hash not checked', A('policy.ts'), 'if (policy.promptTemplateHash !== PROMPT_TEMPLATE_HASH) return bad(', 'if (false) return bad('],
  ['policy binding', 'appeal template hash not checked', A('policy.ts'), 'if (policy.appealPromptTemplateHash !== APPEAL_PROMPT_TEMPLATE_HASH) return bad(', 'if (false) return bad('],
  ['policy binding', 'registry hash not checked', A('service.ts'), 'if (this.#cfg.registry.hash === c.adjudication.registryHash) return null;', 'return null;'],
  ['no re-roll', 'judged record not cached', A('service.ts'), '      this.#judged.set(key, judged);\n', ''],
  ['no re-roll', 'appeal registration not checked before judging', A('service.ts'), "    if (role !== 'appeal') {\n      const next", "    if (false) {\n      const next"],
  ['no re-roll', 'publication failure not caught', A('service.ts'), "      } catch (e) {\n        // T-372: the error's class only, as passProblem", "      } catch (e) {\n        throw e; // T-372: the error's class only, as passProblem"],
  ['appeal', 'appeal judged with the first-instance template', A('service.ts'), "template: appeal ? 'appeal' : 'first-instance',", "template: 'first-instance',"],
  ['appeal', 'appeal panel uses the first-instance size', A('service.ts'), '      const size = appeal ? policy.appealPanelSize : policy.panelSize;\n      const familiesAvailable', '      const size = policy.panelSize;\n      const familiesAvailable'],
  ['appeal', 'appeal panel uses the first-instance family minimum', A('service.ts'), 'const minFamilies = appeal ? Math.max(policy.minFamilies, Math.min(policy.minFamiliesAppeal, familiesAvailable)) : policy.minFamilies;', 'const minFamilies = policy.minFamilies;'],
  ['appeal', 'appeal panel uses the first-instance minValid', A('service.ts'), 'minValid: appeal ? policy.minValidAppeal : policy.minValid,', 'minValid: policy.minValid,'],
  ['appeal', 'key ground waves through a reject', A('service.ts'), "} else if (appeal && task.appealGround === 'missing-or-wrong-key' && task.firstOutcome === 'accept') {", "} else if (appeal && task.appealGround === 'missing-or-wrong-key') {"],
  ['appeal', 'inconclusive party appeal does not leave the first decision standing', A('service.ts'), 'signedOutcome(draft.aggregate.decision, { appeal, ...(task.firstOutcome ? { firstOutcome: task.firstOutcome } : {}) })', 'signedOutcome(draft.aggregate.decision, { appeal })'],
  ['intake', 'store mismatch decided as reject', A('service.ts'), "      return err(problem('invalid_state', 'the stored ciphertext does not match the delivery; retrying later'));", "      return ok('reject');"],
  ['intake', 'unopenable key escalates after publishing', A('service.ts'), "      return err(problem('invalid_state', `this adjudicator cannot open its key", "      return ok('escalate'); err(problem('invalid_state', `this adjudicator cannot open its key"],
  ['keys', 'accept without the key for the buyer', A('service.ts'), "if (outcome === 'accept' && judged.contentKey && task.firstOutcome !== 'reject') unsigned.keyForBuyer =", 'if (false) unsigned.keyForBuyer ='],
  ['keys', 'an overturned reject carries the key to the refunded buyer (T-211)', A('service.ts'), " && task.firstOutcome !== 'reject') unsigned.keyForBuyer =", ') unsigned.keyForBuyer ='],
  ['keys', 'the accept after an escalation loses its key (T-211)', A('service.ts'), "task.firstOutcome !== 'reject') unsigned.keyForBuyer =", "task.firstOutcome === 'accept') unsigned.keyForBuyer ="],
  ['keys', 'escalate without the appeal key', A('service.ts'), '      unsigned.encryptedKeys = wrapKeyForRecipients(', '      void wrapKeyForRecipients('],
  ['keys', 'buyer key not validated before judging', A('service.ts'), '      buyerKey = decodePublicKey(commitment.buyerEncryptionPublicKey);', '      buyerKey = new Uint8Array(32);'],
  ['record', 'record hash covers the signature', A('service.ts'), '  delete body.signature;\n', ''],
  ['decision', 'role not in the decision nonce', A('service.ts'), '`holdback.decision-nonce.v1:${role}:${attempt}`', '`holdback.decision-nonce.v1:${attempt}`'],
  ['acceptance', 'acceptance reserves no bond on SimChain', A('service.ts'), ' as TokenAmount) : c.price,', " as TokenAmount) : ({ ...c.price, amount: '0' } as typeof c.price),"],
  ['acceptance', 'acceptance reserves the price on a chain (ADR-0031)', A('service.ts'), 'bondReserved: this.#cfg.settlement.phaseOne ? (', 'bondReserved: false ? ('],
  ['consent', 'a chain fallback checks a bond that does not exist (ADR-0031, T-349 review)', A('service.ts'), '    if (this.#port.phaseOne) return null;\n    const cover', '    const cover'],
  ['consent', 'appeal windows not checked (T-211)', A('service.ts'), '      if (c.timing[field] > max) {', '      if (false) {'],
  ['consent', 'fee not checked', A('service.ts'), 'if (BigInt(fee.amount) < BigInt(min.amount)) return problem(', 'if (false) return problem('],
  ['consent', 'fee token not checked (T-211)', A('service.ts'), 'if (fee.token !== min.token) return problem(', 'if (false) return problem('],
  ['consent', 'free bond not checked (T-211)', A('service.ts'), '    if (cover >= BigInt(c.price.amount)) return null;', '    if (true) return null;'],
  ['consent', 'fallback and appeal turns not checked (T-211)', A('service.ts'), "    if (role !== 'primary') {\n      const mine", "    if (false) {\n      const mine"],
  ['consent', 'a takeover it declines is triggered anyway (T-211)', A('service.ts'), '      if (declined) report.refused.push(', '      if (false) report.refused.push('],
  ['consent', 'offers accepted whatever their terms (T-211)', A('service.ts'), '    return this.#termsMismatch(c) ?? this.#windowsProblem(c) ?? this.#feeProblem(c);\n  }', '    return null;\n  }'],
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
  ['consent', 'a throwing expiry aborts the pass (T-211, review nit 4)', A('service.ts'), "      } catch (e) {\n        // T-372: the error's class only; the demo publishes refusals", "      } catch (e) {\n        throw e; // T-372: the error's class only; the demo publishes refusals"],
  ['consent', "a task's terms not checked against the commitment ID (T-211, red team H5, J2)", A('service.ts'), '    const mismatch = this.#termsMismatch(commitment);\n    if (mismatch) return err(mismatch);', '    const mismatch = null;\n    if (mismatch) return err(mismatch);'],
  ['consent', "an offer's terms not checked against the commitment ID (T-211)", A('service.ts'), 'return this.#termsMismatch(c) ?? this.#windowsProblem(c)', 'return this.#windowsProblem(c)'],
  ['consent', 'the wrong-key re-release gated on the fee (T-211, red team J3)', A('service.ts'), " || (role === 'appeal' && mine(task.firstDecider)) || rerelease;", " || (role === 'appeal' && mine(task.firstDecider));"],
  // The SimChain adapter (end-to-end tests in simchain-adapter.test.ts).
  ['simchain adapter', 'a fallback or appeal adjudicator given no released envelope', A('simchain-adapter.ts'), "task.role === 'primary' ? undefined : released.at(-1)", 'undefined'],
  ['simchain adapter', 'fallback given no released key', A('simchain-adapter.ts'), "const releasedKey = task.role === 'primary' ? undefined : released.at(-1);", 'const releasedKey = undefined;'],
  ['simchain adapter', 'fallback takes no task after the takeover', A('simchain-adapter.ts'), "else if (s.kind === 'FallbackJudging' && lc(fallbackAdjudicator) === me)", 'else if (false)'],
  ['simchain adapter', 'offers not found in the event log', A('simchain-adapter.ts'), "if (e.type === 'commitment.offered') {", "if (e.type === 'commitment.agreed') {"],
  ['simchain adapter', 'acceptance submitted as a decision', A('simchain-adapter.ts'), "{ kind: 'adjudicator_accept', message }", "{ kind: 'decide', message: message as never }"],
  ['simchain adapter', "SimChain's takeover reservation not counted in the cover (T-211)", A('simchain-adapter.ts'), '    return (free > 0n ? free : 0n) + held;', '    return free > 0n ? free : 0n;'],
  ['simchain adapter', 'SimChain counts only the reservation after the takeover (T-211, red team K5)', A('simchain-adapter.ts'), '    return (free > 0n ? free : 0n) + held;', '    return held;'],
  ['simchain adapter', 'appeal expiries of another decider (T-211)', A('simchain-adapter.ts'), ' || lc(s.via.decision.adjudicator) !== lc(adjudicator)) return false;', ') return false;'],
  ['simchain adapter', 'appeal expiry before appealBy (T-211)', A('simchain-adapter.ts'), "(a.kind === 'none' && now >= Date.parse(a.appealBy))", "(a.kind === 'none')"],
  ['simchain adapter', 'open appeal expiry before appealDecideBy (T-211, review nit 1)', A('simchain-adapter.ts'), "(a.kind === 'open' && now >= Date.parse(a.appealDecideBy))", "(a.kind === 'open')"],
  ['simchain adapter', 'a takeover past fallbackBy still due (T-211)', A('simchain-adapter.ts'), ' && now < Date.parse(c.timing.fallbackBy))', ')'],
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
