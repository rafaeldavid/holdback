// Re-seats recorded judge verdicts after a change that moves commitment IDs (a schemaVersion or domain bump, a new
// policy hash): every judge input moves, and so can the panel, because the draw hashes the commitment ID. It never
// changes a verdict, only the seat it is filed under and the bindings the runner checks (provider, family, model,
// template, input and rubric hashes, from the new request):
//   - a judge still seated keeps its own verdict;
//   - a newly seated judge takes the verdict of an old judge of the same role that is no longer seated, the same
//     family first, keeping its capturedFrom (authored stays authored);
//   - a seat with no old verdict left gets the fake passing verdict (capturedFrom fake), as --judges fake --record would;
//   - an old recording no judge asks for any more is removed.
// It runs each scenario on SimChain until the set of judge requests is stable (a later panel depends on earlier
// verdicts), and prints every verdict that changed seat, so the move can be reviewed and named in the commit.
// Used for T-212 item 3 (ADR-0029); D27d did the same by hand. Afterwards: pnpm snap --update <every fixture>, and
// review the diff (only panel and hash lines should move).
// Run: pnpm exec tsc -b packages/testkit && node scripts/reseat-recordings.mjs [scenario...]
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tk = await import(join(root, 'packages/testkit/dist/index.js'));
const recDir = join(root, 'fixtures', 'recordings');
const KEYS = ['format', 'scenario', 'role', 'judgeId', 'provider', 'family', 'model', 'promptTemplateHash', 'inputHash', 'rubricHash', 'capturedFrom', 'verdict'];

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(recDir).filter((d) => !d.endsWith('.json'));
for (const name of names) {
  const old = new Map(); // `${role}|${judgeId}` -> recording
  for (const role of ['primary', 'fallback', 'appeal']) {
    const dir = join(recDir, name, role);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      old.set(`${role}|${r.judgeId}`, r);
    }
  }
  const scenario = tk.parseScenario(readFileSync(join(root, 'fixtures', 'scenarios', `${name}.scenario.yaml`), 'utf8'), name);
  const acceptance = scenario.terms && existsSync(join(root, scenario.terms)) ? tk.loadTermsFile(join(root, scenario.terms)).acceptance : tk.STUB_ACCEPTANCE;
  const fake = new tk.FakeJudges(acceptance.rubric.criteria.map((c) => c.id));

  let requestedKeys = new Set();
  let requests = new Map();
  let assignment = new Map();
  for (let pass = 0; pass < 6; pass++) {
    // Assign from the previous pass's requests: the judge's own verdict first, then an unseated old judge's.
    assignment = new Map();
    const unseated = (role) => [...old.entries()].filter(([k]) => k.startsWith(`${role}|`) && !requestedKeys.has(k));
    const used = new Set();
    const choose = (key, role, family) => {
      if (assignment.has(key)) return assignment.get(key);
      let pick = null;
      if (old.has(key)) pick = old.get(key);
      else {
        const free = unseated(role).filter(([k]) => !used.has(k));
        const chosen = free.find(([, r]) => r.family === family) ?? free[0];
        if (chosen) {
          used.add(chosen[0]);
          pick = chosen[1];
        }
      }
      assignment.set(key, pick);
      return pick;
    };
    const seen = new Map();
    const provider = {
      kind: 'recorded',
      judge(request) {
        const key = `${request.role}|${request.judgeId}`;
        seen.set(key, request);
        const pick = choose(key, request.role, request.family);
        if (pick) return { status: 'recorded', verdict: pick.verdict, capturedFrom: pick.capturedFrom };
        return fake.judge(request);
      },
    };
    const ctx = tk.createContext({ seed: scenario.pragmas.seed });
    await new tk.StubSettlement(ctx, scenario, provider, root, { kind: 'sim' }).run();
    const keys = new Set(seen.keys());
    const stable = keys.size === requestedKeys.size && [...keys].every((k) => requestedKeys.has(k));
    requestedKeys = keys;
    requests = seen;
    if (stable && pass > 0) break;
  }
  const notes = [];
  for (const [key, request] of requests) {
    const pick = assignment.get(key);
    const rec = { format: 'holdback.recording/v1', ...request, capturedFrom: pick ? pick.capturedFrom : 'fake', verdict: pick ? pick.verdict : fake.judge(request).verdict };
    const path = join(recDir, name, request.role, `${request.judgeId}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, rec[k]])), null, 2)}\n`);
    if (!pick) notes.push(`${key}: new seat, fake verdict`);
    else if (`${pick.role}|${pick.judgeId}` !== key) notes.push(`${key}: takes ${pick.role}|${pick.judgeId}'s ${pick.capturedFrom} verdict (${pick.verdict.overall})`);
  }
  for (const [key, r] of old) {
    if (!requests.has(key)) {
      unlinkSync(join(recDir, name, r.role, `${r.judgeId}.json`));
      notes.push(`${key}: no longer seated, removed`);
    }
  }
  console.log(`${name}: ${requests.size} seats${notes.length ? `\n  ${notes.join('\n  ')}` : ''}`);
}
