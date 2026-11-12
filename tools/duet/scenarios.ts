// The three scenarios (T-391), each an owner's brief for each side and what the run should end with. A brief is
// what a person would tell its agent: what it sells or needs, the budget, where the docs and its tools are, and the
// owner's own rules. It says nothing else about Crow: an agent that cannot work from the docs is the finding.
import type { Policy } from './tools.ts';

export type ScenarioName = 'paid' | 'refund' | 'bad-offer';
export const SCENARIOS: readonly ScenarioName[] = ['paid', 'refund', 'bad-offer'];

/** The work the buyer wants: an audit of three files at one commit, 400 lines. The job API prices it at 700.00 test tokens. */
export const SCOPE = { commit: '7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c', files: ['contracts/Vault.sol', 'contracts/InterestModel.sol', 'contracts/PriceFeed.sol'], lines: 400 } as const;
/** The buyer owner's budget, everything included: 750.00 test tokens in base units (6 decimals). */
export const BUDGET = '750000000';
/** The checks the buyer's owner requires in every offer: each file in scope reviewed, every finding inside the scope. */
export const REQUIRED_CHECKS = ['coverage', 'scope'] as const;

export interface Scenario {
  name: ScenarioName;
  /** One line for the replay page and the list. */
  title: string;
  /** What the run should end with, in plain words. */
  expect: string;
  /** The final state that counts as right; `none` means no hold was ever funded. */
  endState: 'Released' | 'Refunded' | 'none';
  /** What the seller's job API returns. */
  report: 'ok' | 'missing-file';
  policy: Policy;
  /** The owner's own rules, added to each brief; what the replay page shows as pre-set. */
  sellerRule?: string;
  buyerRule?: string;
}

export const scenario = (name: ScenarioName): Scenario => {
  const policy: Policy = { budget: BUDGET, requiredChecks: [...REQUIRED_CHECKS] };
  if (name === 'paid') return { name, title: 'A paid deal', expect: 'Released: the work passes the checks, the seller is paid, and the buyer opens the report.', endState: 'Released', report: 'ok', policy };
  if (name === 'refund')
    return {
      name,
      title: 'A delivery that fails a required check',
      expect: 'Refunded: the report leaves out a file in scope, the coverage check fails, the buyer gets the price back and no key is released.',
      endState: 'Refunded',
      report: 'missing-file',
      policy,
      sellerRule: 'Every report our job API returns is final, as it is: we do not edit reports. If your adapter holds a report back, deliver that same report anyway, by hand, before the delivery deadline; the agreed checks decide whether we are paid.',
    };
  return {
    name,
    title: 'An offer the buyer should refuse',
    expect: 'No hold: the seller offers terms without the coverage check, which the buyer\'s owner requires, so the buyer signs nothing and pays nothing.',
    endState: 'none',
    report: 'ok',
    policy,
    sellerRule: 'We do not offer the `coverage` check: drop it from every offer you make (a terms rule that applies always can drop a check by its id).',
  };
};

export interface BriefFacts {
  docs: { guide: string; sell: string };
  sellerPage: string;
  /** The seller's job API's three addresses. */
  jobApi: { quote: string; start: string; result: string };
  adapterPort: number;
  keyStore: string;
  token: string;
  local: boolean;
}

const money = (base: string) => `${(Number(BigInt(base) / 10_000n) / 100).toFixed(2)}`; // display only: two decimals of a 6-decimal amount

export function sellerBrief(s: Scenario, f: BriefFacts): string {
  return [
    'I am your owner. We run an API that writes security audit reports for smart contracts, and we want to sell its reports to other agents through Crow.',
    `Our job API: POST ${f.jobApi.quote} prices a job from its scope, POST ${f.jobApi.start} starts one, and GET ${f.jobApi.result} returns the report when the job is done. It has the shape of the stub the seller's page describes.`,
    `Crow's agent docs: ${f.docs.guide} and the seller's page, ${f.docs.sell}. Use the seller adapter it describes, with a configuration file you write in your folder. The adapter must listen on port ${f.adapterPort}: that is the port I opened for it. I have set HOLDBACK_KEY (our signing key) and HOLDBACK_OPERATORS for your commands; you never see the key.`,
    `Publish our agent card so buyers can find us, as the docs describe: write the page into the folder public/ in your folder (public/index.html, and public/agent.json if you like). It is served at ${f.sellerPage}. A buyer can reach the adapter's /quote and /defaults at http://127.0.0.1:${f.adapterPort}.`,
    `${f.local ? 'This is a local test world (SimChain, test tokens only): nothing is real money.' : 'This is the public test service (test tokens only): nothing is real money.'} Price in the test token the operators name (${f.token}); our job API's quote does that.`,
    ...(s.sellerRule ? [`My rule for you: ${s.sellerRule}`] : []),
    'Serve one buyer. When its deal ends, Released or Refunded, or no buyer funds an offer within its window, call finish with the outcome, the commitment ID and what we were paid.',
  ].join('\n\n');
}

export function buyerBrief(s: Scenario, f: BriefFacts): string {
  return [
    'I am your owner. I need a security audit report for three smart contract files, and I will pay through Crow.',
    `The work: an audit of ${SCOPE.files.join(', ')} at commit ${SCOPE.commit}, ${SCOPE.lines} lines in all. As a scope: ${JSON.stringify(SCOPE)}.`,
    `A seller I found: ${f.sellerPage}. Read its page to see what it sells and where to ask for a quote.`,
    `My budget: at most ${s.policy.budget} base units of the test token (${money(s.policy.budget)} test tokens), everything included: the price and every fee.`,
    `My requirement: the offer must carry, as required checks, ${s.policy.requiredChecks.map((c) => `"${c}"`).join(' and ')}: every file in the scope is reviewed, and every finding is located inside the scope. I do not buy without them.`,
    `Crow's agent docs: ${f.docs.guide}, and the seller's page of the docs, ${f.docs.sell}, which explains the buyer's signer a seller can ship. Your key store is ${f.keyStore}: I keep your keys there, and the commands use it; you cannot read it.`,
    `When the signer stops for approval, check the offer it shows against this brief. To approve it, run the approve line it prints: I have pre-set my answer to approvals in a policy (my budget and my required checks), and the run tool applies it. Approve only an offer you checked.`,
    ...(s.buyerRule ? [`My rule for you: ${s.buyerRule}`] : []),
    `${f.local ? 'This is a local test world (SimChain, test tokens only): nothing is real money; the signer takes test tokens for the deal from the faucet itself.' : 'This is the public test service (test tokens only): nothing is real money.'}`,
    'When the deal ends, call finish with the outcome, the commitment ID, what you paid, and, if the report was released, what it found in a few lines. If you refuse an offer, finish and say why.',
  ].join('\n\n');
}
