// The six outsider scenarios of roadmap stage 1 ("Outsiders can use it"), for the benchmark harness (T-412, row B1).
// Scenarios 1, 2, 4 and 5 are T-328's (N1a), 3 and 6 are N1b's. Each has:
// - goal: the one sentence a live agent gets, with the docs URL and nothing else about Crow;
// - endState: the state that counts as success;
// - party: the Crow test agent on the other side (the test seller or the test buyer);
// - scripted: how the scripted run plays it in the in-process world (bench-local.mjs), or `blockedBy`, what is missing
//   for the scripted run to play it against Crow's test agents. A blocked scenario still writes a valid record.
//
// Adding a scenario: add an entry here (an ID s<n>), add its scripted agent under scripted/ or name what blocks it, add
// its ID to the record's scenario pattern in scripts/metrics/schemas/one-click.schema.json (version 2), and add its row
// to the test in tests/metrics/one-click-bench.test.ts. The README has the steps.

export const DOCS = 'https://crow.direct/llms.txt';
const TAIL = 'using fresh keys you make yourself and test funds only.';
// Asked of every live agent, so a guess becomes data: one line per guess, read by bench-record.mjs (docGapsOf).
export const GUESS_RULE = 'Whenever the docs leave you unsure and you have to guess, write one line in your reply that starts "GUESS:" and says what you guessed and which doc section left it open.';

const TRY = 'examples/try.ts';

/** @type {Record<string, { name: string, goal: string, endState: 'Released'|'Refunded', party: 'test-seller'|'test-buyer', scripted: { script: string, args: string[], needs: 'seller'|'buyer' } | { blockedBy: string } }>} */
export const SCENARIOS = {
  s1: {
    name: 'a dataset under checks the buyer chooses',
    goal: `Using the docs at ${DOCS}, buy a small dataset from Crow's live test seller on Sepolia under deterministic acceptance checks you choose yourself, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-seller',
    scripted: { script: TRY, args: ['--seller', '{seller}'], needs: 'seller' },
  },
  s2: {
    name: 'rubric-judged written work',
    goal: `Using the docs at ${DOCS}, buy a short piece of written work from Crow's live test seller on Sepolia that a judge panel grades against a rubric you write, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-seller',
    scripted: { blockedBy: 'N70: the test seller sells no rubric-judged item (apps/test-agents/src/catalog.ts has one checks-only dataset)' },
  },
  s3: {
    name: 'a deal the seller starts',
    goal: `Using the docs at ${DOCS}, sell a small dataset to Crow's live test buyer on Sepolia: offer it on Crow under deterministic checks, deliver it, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-buyer',
    scripted: { script: 'tools/one-click/scripted/sell-to-buyer.ts', args: [], needs: 'buyer' },
  },
  s4: {
    name: 'a delivery that fails the checks',
    goal: `Using the docs at ${DOCS}, buy from Crow's live test seller on Sepolia a delivery that fails your acceptance checks and is rejected, and take the deal through to Refunded, ${TAIL}`,
    endState: 'Refunded',
    party: 'test-seller',
    scripted: { script: TRY, args: ['--seller', '{seller}', '--outcome', 'refund'], needs: 'seller' },
  },
  s5: {
    name: 'a missed deadline and the buyer reclaims',
    goal: `Using the docs at ${DOCS}, make a deal with Crow's live test seller on Sepolia in which the seller misses its delivery deadline, and get your held funds back through the buyer's reclaim, ${TAIL}`,
    endState: 'Refunded', // a reclaim ends Refunded on chain; the harness does not tell it from a rejection
    party: 'test-seller',
    scripted: { blockedBy: 'N70: the test seller has no outcome that never delivers, so its delivery deadline cannot pass (catalog.ts: release and refund only)' },
  },
  s6: {
    name: "a robot's data log checked against an agreed format",
    goal: `Using the docs at ${DOCS}, you are a robot fleet's agent: sell one robot run's data log, a CSV with one row per joint reading, to Crow's live test buyer on Sepolia under deterministic checks that state the log's format, deliver it, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-buyer',
    scripted: { script: 'tools/one-click/scripted/robot-log.ts', args: [], needs: 'buyer' },
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
