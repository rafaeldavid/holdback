// The three scenarios (T-391), each a company's brief for each side and what the run should end with. A brief is
// what a person would tell its agent: what it sells or needs, the budget, where the docs and its tools are, and the
// owner's own rules. It says nothing else about Crow: an agent that cannot work from the docs is the finding.
import { readFileSync } from 'node:fs';
import type { Policy } from './tools.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ScenarioName = 'paid' | 'refund' | 'bad-offer' | 'late-offer';
export const SCENARIOS: readonly ScenarioName[] = ['paid', 'refund', 'bad-offer', 'late-offer'];

/** The work the buyer wants: an audit of three files at one commit, 400 lines. The job API prices it at 700.00 test tokens. */
export const SCOPE = { commit: '7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c', files: ['contracts/Vault.sol', 'contracts/InterestModel.sol', 'contracts/PriceFeed.sol'], lines: 400 } as const;
/** The buyer's budget, everything included: 750.00 test tokens in base units (6 decimals). */
export const BUDGET = '750000000';
/**
 * What a person reads as each agent's name (Rafa, 2026-11-12): the replay page, the printed plan and run lines, the
 * tickets. The record's own roles stay `buyer` and `seller`, so every record replays.
 */
export const AGENT_NAME = { buyer: 'Enterprise Procurement Agent', seller: 'Enterprise Sales Agent' } as const;

/** What the buyer buys, as the replay page names it. */
export const ITEM = 'a software security audit';
/** The checks the buyer requires in every offer: each file in scope reviewed, every finding inside the scope. */
export const REQUIRED_CHECKS = ['coverage', 'scope'] as const;
/** The buyer's dates: the report within 3 days (259,200 s), judging within a day after that, an offer made within 10 minutes of now. */
export const LATEST_DELIVERY_SEC = 259_200;
export const DECISION_SLACK_SEC = 86_400;
export const CREATED_AT_BAND_SEC = 600;

/**
 * The buyer's own copy of each check it requires, whole: the audit-report template's check filled from the
 * owner's own scope (a whole-string "{{field}}" takes the field's value, "{{field.length}}" a list's length, and a
 * placeholder inside a longer string its text). The policy approves only an offer whose check is this, not merely one
 * with the same name: a check kept by name and emptied would otherwise pass (the second red team's High).
 */
export function ownerChecks(ids: readonly string[] = REQUIRED_CHECKS, scope: J = SCOPE): Record<string, unknown> {
  const template = JSON.parse(readFileSync(new URL('../../examples/seller-adapter.template.json', import.meta.url), 'utf8'));
  const value = (path: string): J => (path.endsWith('.length') ? scope[path.slice(0, -7)]?.length : scope[path]);
  const fill = (node: J): J => {
    if (typeof node === 'string') {
      const whole = /^\{\{([\w.]+)\}\}$/.exec(node);
      if (whole) return value(whole[1]!);
      return node.replace(/\{\{([\w.]+)\}\}/g, (_m, p: string) => String(value(p)));
    }
    if (Array.isArray(node)) return node.map(fill);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]));
    return node;
  };
  return Object.fromEntries(ids.map((id) => {
    const c = (template.checks as J[]).find((x) => x.id === id);
    if (!c) throw new Error(`the audit-report template has no check ${id}`);
    return [id, fill(c)];
  }));
}

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
  /** The company's own rules, added to each brief; what the replay page shows as pre-set. */
  sellerRule?: string;
  /** The seller's rule as the replay page says it, in plain words. */
  sellerRulePlain?: string;
  /** The seller's rule in the direct brief: the company's intent, with no Crow how-to. */
  sellerRuleDirect?: string;
  buyerRule?: string;
  /** What a reader of the replay must know about this scenario's set-up, in plain words. */
  note?: string;
}

export const scenario = (name: ScenarioName): Scenario => {
  const policy: Policy = { budget: BUDGET, requiredChecks: [...REQUIRED_CHECKS], checkBodies: ownerChecks(), latestDeliverySec: LATEST_DELIVERY_SEC, decisionSlackSec: DECISION_SLACK_SEC, createdAtBandSec: CREATED_AT_BAND_SEC };
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
      sellerRulePlain: 'Send every report exactly as the order system produces it, even one the selling tool holds back.',
      sellerRuleDirect: 'Every report our job API returns is final, as it is: we do not edit reports. If your selling service holds a report back, deliver that same report anyway, before the delivery deadline; the agreed checks decide whether we are paid.',
      note: "The seller told its agent to send whatever its order system produced. Crow's selling tool runs the agreed checks before it sends a report, and would have held this one back. The agent sent it by hand instead, and the checks run by the reviewer both sides chose turned it down.",
    };
  if (name === 'late-offer')
    return {
      name,
      title: 'An offer that would tie up the payment for years',
      expect: "No hold: the seller's terms give it three years to deliver, the buyer accepts three days at most, and the company's pre-set policy refuses to approve, so nothing is signed or paid.",
      endState: 'none',
      report: 'ok',
      policy,
      sellerRule: 'We deliver at our own pace: every offer gives us three years (94,608,000 seconds) to deliver. A terms rule that applies always can set the delivery window.',
      sellerRulePlain: 'Give the seller three years to deliver in every offer.',
      sellerRuleDirect: 'We deliver at our own pace: every offer gives us three years to deliver.',
      note: "The buyer set its answer to approval requests in advance: within the budget, with the required checks, the report due within three days, and an offer dated now. An offer outside that is refused, whoever asks.",
    };
  return {
    name,
    title: 'An offer the buyer should refuse',
    expect: 'No hold: the seller offers terms without the coverage check, which the buyer\'s company requires, so the buyer signs nothing and pays nothing.',
    endState: 'none',
    report: 'ok',
    policy,
    sellerRule: 'We do not offer the `coverage` check: drop it from every offer you make (a terms rule that applies always can drop a check by its id).',
    sellerRulePlain: 'Leave the check that every file was reviewed out of every offer.',
    sellerRuleDirect: 'We do not offer the check that every file in scope was reviewed: leave it out of every offer you make.',
  };
};

export interface BriefFacts {
  docs: { guide: string; sell: string; buy: string };
  sellerPage: string;
  /** The seller's job API's three addresses. */
  jobApi: { quote: string; start: string; result: string };
  adapterPort: number;
  keyStore: string;
  token: string;
  local: boolean;
}

const money = (base: string) => `${(Number(BigInt(base) / 10_000n) / 100).toFixed(2)}`; // display only: two decimals of a 6-decimal amount

/**
 * The brief's style (Rafa, 2026-11-12, "After the baseline"). `guided`, the default: the company's brief names Crow's
 * guides and how to use its tools. `direct`: the cold start. The brief holds only the company's intent, its limits
 * and facts about its own setup, and names Crow only as crow.direct; the agent finds the guides from the front door.
 */
export type BriefMode = 'guided' | 'direct';

export function sellerBriefDirect(s: Scenario, f: BriefFacts): string {
  return [
    'You work for our company. We run an API that writes security audit reports for smart contracts, and we sell its reports to other agents through crow.direct.',
    `Our job API: POST ${f.jobApi.quote} prices a job from its scope, POST ${f.jobApi.start} starts one, and GET ${f.jobApi.result} returns the report when the job is done.`,
    `We opened port ${f.adapterPort} on this machine for the service that sells for us: buyers reach it at http://127.0.0.1:${f.adapterPort}. We have set HOLDBACK_KEY (our signing key) and HOLDBACK_OPERATORS for your commands; you never see the key.`,
    `Our public page is served from the folder public/ in your folder, at ${f.sellerPage}.`,
    `${f.local ? 'This is a test, on a local test setup with test money: nothing is real money.' : 'This is a test, with test money: nothing is real money.'}`,
    ...(s.sellerRuleDirect ? [`Our rule for you: ${s.sellerRuleDirect}`] : []),
    'Serve one buyer. When its deal ends, or no buyer pays within the offer\'s window, call finish with the outcome and what we were paid.',
  ].join('\n\n');
}

export function buyerBriefDirect(s: Scenario, f: BriefFacts): string {
  return [
    'You work for our company. We need a security audit report for three smart contract files, and we will pay through crow.direct.',
    `The work: an audit of ${SCOPE.files.join(', ')} at commit ${SCOPE.commit}, ${SCOPE.lines} lines in all. As a scope: ${JSON.stringify(SCOPE)}.`,
    `A seller we found: ${f.sellerPage}.`,
    `Our budget: at most ${s.policy.budget} base units of the test token (${money(s.policy.budget)} test tokens), everything included: the price and every fee.`,
    `Our requirement: the offer must carry, as required checks, ${s.policy.requiredChecks.map((c) => `"${c}"`).join(' and ')}: every file in the scope is reviewed, and every finding is located inside the scope. We do not buy without them.`,
    `Our dates: the report must be due within ${s.policy.latestDeliverySec / 86_400} days of now, and the offer must be dated now, not in the future or the past.`,
    `Your key store is ${f.keyStore}: we keep your keys there, and your commands use it; you cannot read it. Our approval policy is preset: it answers any approval you ask for.`,
    `${f.local ? 'This is a test, on a local test setup with test money: nothing is real money.' : 'This is a test, with test money: nothing is real money.'}`,
    'When the deal ends, call finish with the outcome, what you paid, and, if you received the report, what it found in a few lines. If you refuse an offer, finish and say why.',
  ].join('\n\n');
}

export function sellerBrief(s: Scenario, f: BriefFacts): string {
  return [
    'You work for our company. We run an API that writes security audit reports for smart contracts, and we want to sell its reports to other agents through Crow.',
    `Our job API: POST ${f.jobApi.quote} prices a job from its scope, POST ${f.jobApi.start} starts one, and GET ${f.jobApi.result} returns the report when the job is done. It has the shape of the stub the seller's page describes.`,
    `Crow's agent docs: ${f.docs.guide}, the front page, and its page for sellers, ${f.docs.sell}. Use the seller adapter it describes, with a configuration file you write in your folder. The adapter must listen on port ${f.adapterPort}: that is the port we opened for it. We have set HOLDBACK_KEY (our signing key) and HOLDBACK_OPERATORS for your commands; you never see the key.`,
    `Publish our agent card so buyers can find us, as the docs describe: write the page into the folder public/ in your folder (public/index.html, and public/agent.json if you like). It is served at ${f.sellerPage}. A buyer can reach the adapter's /quote and /defaults at http://127.0.0.1:${f.adapterPort}.`,
    `${f.local ? 'This is a local test world (SimChain, test tokens only): nothing is real money.' : 'This is the public test service (test tokens only): nothing is real money.'} Price in the test token the operators name (${f.token}); our job API's quote does that.`,
    ...(s.sellerRule ? [`Our rule for you: ${s.sellerRule}`] : []),
    'Serve one buyer. When its deal ends, Released or Refunded, or no buyer funds an offer within its window, call finish with the outcome, the commitment ID and what we were paid.',
  ].join('\n\n');
}

export function buyerBrief(s: Scenario, f: BriefFacts): string {
  return [
    'You work for our company. We need a security audit report for three smart contract files, and we will pay through Crow.',
    `The work: an audit of ${SCOPE.files.join(', ')} at commit ${SCOPE.commit}, ${SCOPE.lines} lines in all. As a scope: ${JSON.stringify(SCOPE)}.`,
    `A seller we found: ${f.sellerPage}. Read its page to see what it sells and where to ask for a quote.`,
    `Our budget: at most ${s.policy.budget} base units of the test token (${money(s.policy.budget)} test tokens), everything included: the price and every fee.`,
    `Our requirement: the offer must carry, as required checks, ${s.policy.requiredChecks.map((c) => `"${c}"`).join(' and ')}: every file in the scope is reviewed, and every finding is located inside the scope. We do not buy without them.`,
    `Our dates: the report must be due within ${s.policy.latestDeliverySec / 86_400} days of now, and the offer must be dated now, not in the future or the past.`,
    `Crow's agent docs: ${f.docs.guide}, the front page, and its page for buyers, ${f.docs.buy}, which explains the buyer's signer. Your key store is ${f.keyStore}: we keep your keys there, and the commands use it; you cannot read it.`,
    `When the signer stops for approval, check the offer it shows against this brief. To approve it, run the approve line it prints: we have pre-set our answer to approvals in a policy (our budget, our required checks and our dates), and the run tool applies it. Approve only an offer you checked.`,
    ...(s.buyerRule ? [`Our rule for you: ${s.buyerRule}`] : []),
    `${f.local ? 'This is a local test world (SimChain, test tokens only): nothing is real money; the signer takes test tokens for the deal from the faucet itself.' : 'This is the public test service (test tokens only): nothing is real money.'}`,
    'When the deal ends, call finish with the outcome, the commitment ID, what you paid, and, if the report was released, what it found in a few lines. If you refuse an offer, finish and say why.',
  ].join('\n\n');
}
