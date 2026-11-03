# Holdback

## Objective

First and foremost, Holdback is a protocol, not a service. It has three properties:

1. **Any two agents choose their own adjudicator.** The buyer and seller name the primary, fallback and appeal adjudicators in the commitment they both sign. No one assigns them.
2. **Any capital holder can join the bonding.** Anyone can post or back an adjudicator's bond and earn for the capital at risk (ADR-0007; backers proposed in ADR-0014).
3. **Access is by API.** Any operator node serves the REST API and SDK, and agents can also submit signed messages directly to the settlement layer. No single API provider is required (ADR-0005).

The prototype builds machine-speed escrow on that protocol. One agent opens a commitment with another, then:

1. the buyer funds a hold;
2. the seller delivers;
3. a judgment pipeline decides acceptance;
4. the funds are released or refunded.

Any blockchain stays behind the API and SDK. Agents see amounts, states and receipts, not chain mechanics.

**First product priority:** a simple demo that conveys the experience to an AI lab researching agentic commerce (`docs/demo.md`). Build the walking skeleton end to end first, then harden one layer at a time (`docs/plan.md`).

## Litmus tests

Every design and code change must pass all three.

1. **Neutrality** (ADR-0001). No single party can stop a valid commitment from settling according to its terms, or move held funds outside those terms. That covers operator nodes, the rules contract, adjudicators, club operators, on-ramps, model providers and Holdback's own maintainers. Each such actor has a `neutrality.*` fixture showing the transaction still completes when that actor refuses or goes offline. See `docs/neutrality.md`.
2. **The hold** (ADR-0002). Funds are locked so neither party can take them alone. Holds have an expiry and idempotent operations, and cannot be double spent. Fiat and card rails are funding and payout adapters only. Custody stays on the neutral settlement layer.
3. **Defended multi-model judgment** (ADR-0006).
   - Declarative deterministic checks run first.
   - A panel of pinned models from at least two families follows, selected by commit-reveal.
   - The panel is defended against injection, gaming, drift and correlated error.
   - Appeals are backed by the adjudicator's bond.

## Design principle: user choice

The parties choose; the protocol enforces what they chose. Offer options with stated tradeoffs (settlement mode, adjudicators, registry, checks) instead of one behavior for everyone, unless an option would let one party break the neutrality test against the other. Clubs may narrow the options in their rulebook. See ADR-0015.

**Parametrize, don't restrict (D31).** The protocol and API do not decide values the negotiating agents can manage themselves. Deadlines, windows, amounts and rates are parameters with any value the encoding can represent; a release date far in the future is allowed. Refuse only what is malformed, unrepresentable, or self-contradictory in a way settlement cannot process. Sanity checks ("year 20270 looks like a typo") are advisory warnings an operator may add as a service, never refusals (backlog).

## Design principle: widen collaboration, the law stays the backstop

Holdback extends the set of deals agents can safely make with each other. It does not replace legal recourse: agent owners and controllers will go to court when something goes wrong, and courts can compel real-world parties (residual 5). So the protocol does not need machinery for every dispute. Prefer bounded loss (caps, bonds, expiry) and a clean, signed, attributable record that can serve as evidence, over new protocol steps for edge cases (Rafa, 2026-10-31; D26).

## Design principle: agreed terms bind; the buyer carries the burden of acceptance

The seller offers terms; the buyer agrees to them or doesn't. Once agreed, the terms bind whether or not they turn out favourable. Judges check the work against the agreed terms only, never their fairness. A buyer who wants protection writes it into the acceptance checks and rubric before agreeing. After an accept, a buyer who appeals must show the work fails the terms; otherwise the first decision stands (Rafa, 2026-10-31; D28).

It is not the protocol's job to decide whether terms are favourable or a party is malicious. As in contract law, the parties negotiate dispute clauses (what happens when the adjudicator is involved: on a screen flag, an unreadable delivery, an inconclusive panel, who bears fees). The protocol supplies **default rules** that apply when the terms are silent (today's D27 rules), and keeps **mandatory rules** no agreement can waive: the hard rules and the three litmus tests. Clubs may narrow the clauses in their rulebook; adjudicators may decline clauses they won't run (D29, after the demo).

Responsibility sits with the buyer and the seller. When a party can protect itself with a check it runs before signing, the protocol does not add settlement machinery for the party that skipped it; prefer the simpler fix (Rafa, 2026-11-01; D32).

## Design principle: rails, not a record-keeper

The protocol and the API are rails: they hold funds, check signatures, enforce deadlines and settle. They need keys, hashes and amounts, not identities or content. Everything else is information each party chooses to disclose, to whom and when: who it is, what it bought, the terms, the judgment. The default is minimal disclosure; a party can reveal more to its counterparty, an adjudicator, a club or a court. Arbitration can be private too: adjudicators may judge with private inference (an inference provider that keeps no data, such as Venice, offered as an option) as long as the judges stay pinned models from at least two families (Rafa, 2026-11-01; D35).

## Hard rules

Each rule is paired with the check that enforces it in `docs/team.md` (Rules and checks).

- **No real money.** Run only on the in-process SimChain, a local chain or a testnet. Refuse to start with a Stripe key that is not `sk_test_…` or with a mainnet chain ID.
- **No admin keys.** Settlement contracts have no owner, pause, freeze, blacklist or upgrade proxy.
- **Secrets** come from environment variables only. Never read or print `.env*`.
- **Money** is a token amount in base units, as a decimal string, plus a token identifier. No floats. Rates are integers: basis points or a numerator/denominator pair. No float in any hashed body (ADR-0022).
- **Signed messages.** Every state-changing message from an agent is an EIP-712 signature checked against the agent's address and scope. Operators relay messages; they never author them. In private and judgment-level deals the signer is a per-deal key: settlement checks its signature, and its scope and membership are attested by a `Delegation` certificate that the counterparty and the adjudicator check (ADR-0024, D34).
- **Idempotency.** Every mutating API call takes an `Idempotency-Key`. The same key with the same body replays the response; with a different body it returns 409.
- **Deliverables are untrusted.**
  - Never place their content in a system or instruction position.
  - Judges get no tools, no network access and no secrets.
  - Judge output must match `spec/schemas/judge-verdict.schema.json`, or the judge abstains.
- **No code execution** from commitments or deliverables. Acceptance checks are declarative.
- **Pinned models.** Judges use pinned model IDs from the registry, never `latest`. Never re-roll a panel because of its verdict.
- **The contract.** `spec/schemas/` is the API contract. Change it only through an ADR plus a version bump.

## How to verify your work

Make results observable before claiming them. Label each claim in reports and PRs as measured, inferred or guessed.

```
pnpm install                    # Node 22, pnpm 12 (via corepack)
pnpm typecheck && pnpm test     # types, unit + property tests (no network)
pnpm verify                     # all checks + snap + demo; writes reports/verify-<branch>.md
pnpm lint                       # ESLint, including the no-eval and money rules
pnpm validate:spec              # spec/examples against spec/schemas (Ajv 2020-12, strict)
pnpm snap                       # scenario fixtures vs .expect.md snapshots
pnpm snap --update <name>       # regenerate a snapshot; review the diff before committing
pnpm demo                       # scripted judges: no keys needed; writes demo/out
pnpm demo --live                # live judges (needs two model-family keys)
(cd contracts && forge test)    # contracts, local chain only (Phase 2)
formal/check.sh                 # TLA+ model of the state machine (T-204); safety in seconds, liveness ~11 min
node site/build.mjs && node site/check.mjs   # the site and its agent docs (site/llms.txt)
```

## Start here (for a new session or agent)

1. Read this file, then the latest `docs/log/` entry (files are named by date, `YYYY-MM-DD.md`; take the newest): its "Next steps (resume here)" list is the current work. Check `gh pr list` for open PRs before starting a task that may already be in flight.
2. `docs/plan.md` lists every task by phase; each task file in `docs/tasks/` has Intent, acceptance criteria, Evidence and a Handoff section that says how to resume.
3. `docs/operations.md`: what is live (escrow.stream, the API, sign-ups), how to deploy, secrets handling, and the gates.
4. Open decisions and their history: `docs/decisions-today.md` (D1 to D40) and `docs/decisions/` (ADRs).

## Working as a team of agents

- Pick up work only through a task file in `docs/tasks/`. Restate the task's intent in your own words before writing code.
- Contributors beyond the founder's own sessions, people and their agents, work from a fork on approved tasks or issues labelled `approved`, open a Proposal issue for anything else, and never merge; see `CONTRIBUTING.md` (Rafa, 2026-11-03).
- Work in your own git worktree and branch (`t-<id>-<slug>`). Keep PRs small, with ordered commits.
- Stay inside the paths the task lists. If you need to touch another lane's files, write that in the task's Handoff section and stop.
- Before you hand off:
  - add or update fixtures;
  - run `/verify`;
  - fill in the task's Evidence and Handoff sections;
  - open a PR.
- **Autonomy inside the repo, gates outside it** (Rafa, 2026-10-31). Anything confined to this repository is pre-approved: ADRs, schema changes, contract code, defense changes, and merging a PR once CI passes and review findings are fixed. Decisions still get a research pass and are recorded in `docs/decisions-today.md`, where Rafa can overrule them. Actions that reach outside the repository still wait for Rafa: deploys, force pushes or history rewrites on the remote, real keys or real money, anything published or sent to other people, and repository access or settings.
- Use the role subagents in `.claude/agents/` and the commands in `.claude/commands/`. Process details are in `docs/team.md`.

## Map

`docs/decisions-today.md` records decisions D1 to D40 (decided October 30, 2026; D4 deferred to Phase 2), and `docs/reviews/` the reviews behind them. Read both first. `docs/backlog.md` holds work deferred until after the basic demo.

The other docs: `PRD.md`, `neutrality.md`, `architecture.md`, `judgment-and-defenses.md`, `api.md`, `demo.md`, `testing.md`, `team.md`, `plan.md`, `decisions/`, `tasks/`. Research is in `docs/research/`; open it only when a decision needs it. `docs/operations.md` covers the live demo and deploys. Brand work is in `brand/`: write Crow in docs; ’crow ("escrow" with the "es" unsaid) is the website's logomark (Rafa, 2026-11-03). Tagline "Programmatic Escrow and Arbitration" (Rafa, 2026-11-02; D40: privacy is each deal's choice), at escrow.stream; its mark is Archibald Thorburn's 1919 hooded crow (public domain); Holdback stays the protocol's working name and EIP-712 domain.

## Vocabulary

club, rulebook, member, agent, mandate, commitment (offered → agreed), hold, delivery, acceptance, deterministic check, rubric criterion, sealed check, screen, panel, judge, verdict, judgment, escalation, appeal, adjudicator, bond, fallback adjudicator, default outcome, operator node, rules contract, escape hatch, rail, on-ramp, off-ramp, SimChain, receipt. Definitions are in `docs/architecture.md` under Glossary.
