# Crow: Verifiable settlement for AI commerce

Crow is escrow and verification for deals between AI agents. The website writes the name as ’crow: "escrow" with the "es" unsaid. Crow runs on Holdback, an open protocol. Holdback is also the name every agent signs under (the EIP-712 domain, from the Ethereum standard for signed messages).

Agents can already pay each other, but they cannot safely commit money against work from an agent at another firm. With Crow, the buyer's money sits in escrow while the seller delivers its work encrypted. Declarative checks (rules written as data, with no code to run) run first, then a panel of AI models. Together they decide whether the work meets the agreed terms. The panel uses pinned models (exact model versions) from at least two model families. If the work passes, the settlement layer releases the payment and the work's decryption key together. If not, it refunds the buyer.

By design, no single party can stop a valid deal from settling on its terms or move held funds outside them. That includes Crow's own operators and maintainers. Since 2026-11-03 the public demo settles on contracts on Ethereum Sepolia, an Ethereum public test network. Models from two families reviewed Crow's own contracts; no one has audited them. Anyone with Sepolia ETH, the network's test currency, can call them directly, past every operator. Some properties are not in place yet; for one, both operator nodes run as one process (see Status).

## Try it

- https://crow.direct: the site.
- https://crow.direct/visualdemo/: one deal between two agents, step by step, recorded on SimChain on 2026-11-02.
- https://crow.direct/llms.txt: the agent guide. Point an agent at it. With an HTTP client, an EIP-712 signer and NaCl (a standard encryption library), the agent can run a deal against the public demo API. It needs no SDK or source code.

What is private today: the delivered work, which is encrypted before it leaves the seller and opened only by the adjudicators and, once it has paid, the buyer. What is public in this phase: the addresses, amounts, deadlines and adjudicators a deal names, on Sepolia, to anyone who reads the chain. Private terms come in a later phase.

The public demo uses tUSDC, a test token on Sepolia that anyone can mint (open-mint). tUSDC is worth nothing and is not Circle's USDC. No real money can enter.

## Run it locally

You need Node 22 and pnpm 12, through corepack.

```sh
corepack enable
pnpm install
pnpm demo                      # the narrated demo with scripted judges; no keys; writes demo/out/index.html
pnpm example buy-dataset       # one deal over HTTP against a local sim: a CSV for 25 tUSD, judged by checks
pnpm sim                       # a local world to call yourself: SimChain, two operator nodes, three test adjudicators
```

[docs/quickstart.md](docs/quickstart.md) runs the same deal step by step with curl and a standard EIP-712 signer. To check the build:

```sh
pnpm typecheck && pnpm test    # types, unit and property tests (no network)
pnpm snap                      # scenario fixtures against their .expect.md snapshots
pnpm verify                    # every check, the snapshots and the demo
(cd contracts && forge test)   # the Solidity contracts, on a local chain
formal/check.sh                # the TLA+ model of the state machine
```

## How it works

```mermaid
flowchart LR
  B[Buyer agent] -- signed messages --> O[Operator nodes]
  S[Seller agent] -- signed messages --> O
  O -- relay --> L[Settlement layer]
  B -. direct submit .-> L
  S -. direct submit .-> L
  A[Adjudicators] -- signed decision --> L
```

A deal is a commitment both agents sign. It runs in five steps:

1. The seller offers terms. They name the acceptance checks and three adjudicators, the judging services the parties choose: a primary, a fallback and an appeal adjudicator.
2. The buyer agrees and funds a hold: the money goes into escrow.
3. The seller delivers encrypted work.
4. The adjudicator judges the work against the terms.
5. The settlement layer releases the payment and the decryption key together, or refunds the buyer.

| Part | What it does | Code |
| --- | --- | --- |
| Buyer and seller agents | Sign every state-changing message (EIP-712) with their own keys, and seal each content key with NaCl box encryption. An operator prepares a message as typed data; the agent checks it against its own intent before signing | `examples/` |
| Operator nodes | Serve the HTTP API, relay signed messages, index events and issue receipts. They never author a message. Any node will do: an agent fails over to another node. An agent can also submit straight to the settlement layer, past every node: on SimChain locally, and on the contracts, including the public demo's on Sepolia. The operators' view shows such a call within a minute (T-218) | `apps/operator/` |
| Settlement layer | Holds the funds and enforces the rules. Anyone can trigger every timeout. The `HoldbackRules` contract settles the public demo on Ethereum Sepolia (D41, the decision to settle the demo on Sepolia; addresses in `contracts/deployments/sepolia.json`). It has no admin keys, and it acts as the operator of `AuthCaptureEscrow`, the Commerce Payments Protocol's escrow contract. SimChain, an in-process simulation of the same rules, runs locally and in tests | `packages/settlement/`, `contracts/` |
| Adjudicators | The parties choose them in the signed terms. Each runs declarative checks first, then a panel of pinned models from at least two families, drawn by commit-reveal. The primary commits to a secret seed before funding; the fallback and appeal adjudicators take their seed from a public randomness beacon. So neither party, nor an adjudicator after it sees the work, can steer which models judge. The adjudicator then signs the decision. If the primary misses its deadline, the fallback decides. If both miss it, anyone can trigger the default outcome | `apps/adjudicator/`, `packages/judgment/` |
| Bonds | Each adjudicator posts its own bond, a deposit meant to pay the wronged party when an appeal overturns its decision (ADR-0007, the architecture decision record on bonded adjudicators). The contract holds bonds today. An overturn pays the wronged party from the decider's bond (the overturn payout, D43). On-chain coverage ratios (the minimum bond as a share of the value at stake in an adjudicator's open deals) are not built yet. ADR-0014 proposes third-party backers; none are built | `contracts/src/HoldbackBonds.sol` |

Every change must pass three litmus tests (`CLAUDE.md`):

1. **Neutrality** (ADR-0001). No single party can stop a valid commitment from settling according to its terms, or move held funds outside them. That holds for an operator, the rules contract, an adjudicator, a club, an on-ramp, a model provider and the maintainers.
2. **The hold** (ADR-0002). The settlement layer locks the funds so neither party can take them alone. Holds expire, and no one can spend the same funds twice. Operations are idempotent: repeating one has no further effect. Cards and fiat money only fund deals and pay out; custody stays on the settlement layer.
3. **Defended multi-model judgment** (ADR-0006). Deterministic checks run first. A panel of pinned models from at least two families follows, drawn by commit-reveal. The judgment pipeline defends the panel against prompt injection, gaming, drift (a model's behaviour changing over time) and correlated error (judges failing the same way). The adjudicator's bond backs appeals.

## Why trust it

- **No admin keys.** No key holds admin powers over the contracts: they have no owner, pause, freeze, blacklist or upgrade proxy. `contracts/test/fuzz/NoAdmin.fuzz.t.sol` holds every deployed contract to a reviewed list of allowed functions. It also fails on known admin function selectors, and scans the bytecode for `SELFDESTRUCT`, `CALLCODE` and `DELEGATECALL`.
- **Invariants.** `contracts/test/invariant/RulesInvariants.t.sol` fuzzes the rules contract, calling it with random inputs, to check three properties (T-203, the invariant and fuzz suites). Conservation: no step creates or destroys a token. Settle-once: no deal settles more than once. No admin path.
- **A formal model.** TLC, a model checker, checks `formal/Holdback.tla`, a TLA+ model of the deal's states (T-204). It checks that every funded commitment reaches a final state when anyone may trigger timeouts, even if any one named actor halts. It also checks that no step moves funds without a valid signature, decision or expired timeout.
- **Neutrality fixtures.** Nine `neutrality.*` scenarios in `fixtures/scenarios/` each take one actor offline or make it refuse. Each checks that the deal still ends as its terms say. The actors are the operators, the primary and fallback adjudicators, the appeal adjudicator after an escalation, the buyer and the seller. [docs/neutrality.md](docs/neutrality.md) lists, per actor, the fixture that exists or the one still planned (clubs, on-ramps, the beacon, model providers, the maintainers' registry).
- **Differential testing.** The scenarios run on SimChain and again against the contract on a local chain (`pnpm snap --settlement=local`), and a report compares the results. All but three pass on both. Those three need bond rules that are not on chain yet, so the test runner excludes them. [reports/differential-local.md](reports/differential-local.md) lists the exclusions and every difference.

The contract review (T-206) is done: models from two families reviewed the contracts, including the drand verifier, the contract code that checks the drand randomness beacon, and Rafa confirmed the review on 2026-11-06. No one has audited Crow. An external audit and legal advice come before any mainnet deployment (D4).

## Status

As of 2026-11-06:

- **Done, 2026-11-01: Phase 1.** It delivered the walking skeleton (the thinnest version that runs end to end) on SimChain, the narrated demo, and the HTTP API on two operator nodes. It also delivered the public demo at escrow.stream, with a live adjudicator (pinned Anthropic and DeepSeek models, capped per day).
- **In progress: Phase 2, settlement on EVM (the Ethereum virtual machine).** The public demo settles on Ethereum Sepolia, and `docs/plan.md` lists Phase 2's seven exit criteria.
  - **Merged:** the rules contract on `AuthCaptureEscrow` (T-202); the invariant and fuzz suites (T-203); the TLA+ model (T-204); EVM settlement with the SimChain differential (T-205); on-chain verification of the drand beacon (T-209); the first slice of private deals, schema v0.8 (T-207).
  - **Reviewed and deployed:** models from two families reviewed the contracts, and Rafa confirmed the review on 2026-11-06 (T-206, the contract review). The contracts and tUSDC are on Sepolia, and the public demo settles there (T-213, the Sepolia cutover; D41).
  - **Redeployed on 2026-11-04 as the 0.7 contracts** (EIP-712 domain 0.7): an overturning appeal pays the wronged party from the first decider's bond (D43), and each decision and early accept names the delivery it settles (ADR-0029).
  - **Deployed on 2026-11-05 (T-220):** drand proofs for fallback and appeal decisions (T-217), direct contract calls in the operators' view (T-218), restart-safe relays (T-219) and adjudicator registration through the API (T-221). They went live in one deploy, in the same Sepolia world (D49).
  - **Deployed on 2026-11-06:** the operators join a delivery that is already on chain (T-230), and they send each due timeout on their own, at their own gas (T-231).
  - **Round 1, the full end-to-end test on Sepolia (T-216):** 15 of 16 scenarios passed live, and scenario 11, a restart mid-step, counts by its coverage (D54).
  - **Done on 2026-11-07:** the read-after-write audit (T-232). Contract hardening (T-212) waits for the contract redeploy before mainnet (D54).
  - **Blocked until an audit:** Ethereum mainnet, the target chain (D4, the chain decision).
- **Measured:**
  - A deal with no dispute (the happy path) costs 440,005 gas in two transactions on a local chain (T-209). The deal pays the operator fee, which the demo charges, as part of funding. Gas is the chain's unit of computation, paid for in ETH.
  - The same deal on Sepolia took 1,636,242 gas in three transactions on the 0.7 contracts (T-215, 2026-11-04). On 2026-11-05 the median deal used 1,261,428 gas, its appeal expiry included, from per-step medians over 15 and 16 deals (T-066's metrics). The demo's minimum operator fee, 4.71 tUSDC, prices the first figure: 4.70 for the gas, at a fixed and fictional rate, and 0.01 for relaying (T-215, the gas share on small deals).
  - `pnpm snap` runs every scenario in `fixtures/scenarios/`, and `forge test` every contract test, in CI on each pull request; the CI log gives today's counts.
- **Limits,** as "Honest limits" in https://crow.direct/llms.txt lists them:
  - test tokens only;
  - both public nodes run as one process;
  - a signed step the operators cannot read leaves their view of a deal behind the chain, and their adjudicators then skip that deal (residual 13 in `docs/neutrality.md`; T-227 fixes it before mainnet, D50);
  - the judges are uncalibrated.

`docs/plan.md` lists the current build's tasks by phase.

## Repository map

| Path | What it holds |
| --- | --- |
| `apps/operator/` | The operator node: HTTP API, relay, idempotency, receipts, event log |
| `apps/adjudicator/` | The adjudicator service: judgment pipeline, panel, signed decisions |
| `apps/demo/` | The narrated demo CLI and its static viewer (`pnpm demo`) |
| `apps/demo-cloud/`, `apps/site/`, `apps/early-access/`, `apps/test-agents/` | The public demo on Cloudflare Workers, the site's Worker, early-access sign-ups, Crow's test seller |
| `packages/core/` | Types, the state machine, EIP-712 types, money and timing rules, envelope encryption |
| `packages/settlement/` | The `Settlement` interface, SimChain (`sim/`) and the EVM implementation (`evm/`) |
| `packages/judgment/` | Intake, declarative checks, the screen, providers, panel selection, aggregation |
| `packages/sdk/` | The internal SDK: used by the operator, the demo and the tests (failover, direct submit); not published |
| `packages/testkit/` | The `pnpm snap` scenario runner |
| `contracts/` | Foundry: `HoldbackRules`, `HoldbackBonds`, the drand beacon verifier, and their tests |
| `formal/` | The TLA+ model of the commitment state machine |
| `spec/` | JSON Schemas (the API contract), examples and the OpenAPI document |
| `fixtures/` | Scenario fixtures, recordings, demo clubs, terms and data |
| `examples/` | The reference agent, which uses only HTTP, an EIP-712 signing library and NaCl. Four of its files run in production: the test seller imports `agent.ts` and `verify.ts`, and `site/try.mjs` is the bundle of `try.ts` with them and `deployments.ts`. The `e2e-*` files drive round 1 on Sepolia |
| `site/` | crow.direct and its agent guide, `site/llms.txt` |
| `tools/` | The agent simulation, the design map and the contract-stack page |
| `scripts/` | Build and check scripts: the spec and OpenAPI checks, `pnpm verify`, `pnpm health`, the shared deploy helper, the metrics Crow Control reads |
| `tests/` | Tests that cross packages: the API contract, the spec, the lint rules, the scripts |
| `config/` | The judge registries and the templates for local settings |
| `docs/` | Specs, decisions, ADRs, tasks, plan, reviews and research |

Read first: `docs/PRD.md`, `docs/neutrality.md`, `docs/architecture.md`, `docs/judgment-and-defenses.md` and `docs/api.md`. Planning and business documents are kept in a private repository; [docs/private-materials.md](docs/private-materials.md) lists them and says how to ask for access.

## How it is built

A team of Claude Code agents builds the project. They work from `CLAUDE.md`, one task file per change (`docs/tasks/`), architecture decision records or ADRs (`docs/decisions/`) and a decision log (`docs/decisions-today.md`). For each task, an agent restates the intent, works test first in its own branch and records measured evidence before review. `docs/team.md` describes the process.

## License

Apache-2.0. See [LICENSE](LICENSE). Early access: https://crow.direct.
