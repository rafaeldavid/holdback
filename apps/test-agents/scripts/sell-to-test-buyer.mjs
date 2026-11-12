// `node apps/test-agents/scripts/sell-to-test-buyer.mjs [--outcome refund]` (T-239): one seller-started deal with
// Crow's test buyer on the Sepolia test environment, played by an outside seller with fresh keys held in memory
// (src/sell-once.ts). The faucet admits the seller; the seller needs no tUSDC and no Sepolia ETH, since the buyer pays
// and the operators relay. It prints one line per step and each transaction's Etherscan link, and exits 0 when the deal
// ends as asked: released by default, refunded with --outcome refund. Test tokens only: it signs for the Sepolia
// deployment pinned in examples/deployments.ts and nothing else. Running it is a live Sepolia run: Rafa's call.
import { knownPins } from '../../../examples/verify.ts';
import { sellOnce } from '../src/sell-once.ts';

const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const BUYER = 'https://crow.direct/agents/test-buyer';

const args = process.argv.slice(2);
const outcome = args.length === 0 ? 'release' : args.length === 2 && args[0] === '--outcome' && args[1] === 'refund' ? 'refund' : null;
if (!outcome) {
  console.error('usage: node apps/test-agents/scripts/sell-to-test-buyer.mjs [--outcome refund]');
  process.exit(2);
}
const pin = knownPins().find((p) => p.domain.chainId === 11155111);
if (!pin) {
  console.error('examples/deployments.ts pins no Sepolia deployment');
  process.exit(1);
}
try {
  await sellOnce({ operators: OPERATORS, pin, outcome, buyer: (path, init) => fetch(`${BUYER}${path}`, init) });
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
