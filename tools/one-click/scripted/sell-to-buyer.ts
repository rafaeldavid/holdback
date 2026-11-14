// The scripted agent of scenario s3 (T-412): an outside seller with fresh keys starts one deal with Crow's test buyer,
// as apps/test-agents/scripts/sell-to-test-buyer.mjs does on Sepolia, here against the in-process world bench.mjs
// serves. It is a plain HTTP client of the operators and the buyer, run in its own Node process so the harness counts
// its calls. It prints one line per step and ends with `done      commitment <id> Released`; it exits 1 otherwise.
//
//   HOLDBACK_OPERATORS=<url>,<url> CROW_TEST_BUYER=<buyer base URL> node --experimental-transform-types tools/one-click/scripted/sell-to-buyer.ts
import { sellOnce } from '../../../apps/test-agents/src/sell-once.ts';
import { knownPins } from '../../../examples/verify.ts';

const operators = (process.env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
const base = process.env['CROW_TEST_BUYER'] ?? '';
const pin = knownPins()[0]!; // SimChain: a scripted run settles only in the in-process world
try {
  const { id } = await sellOnce({ operators, pin, buyer: (path, init) => fetch(`${base}${path}`, init), timeoutMs: 120_000 });
  console.log(`done      commitment ${id} Released`);
} catch (e) {
  console.log(`stopped at: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
