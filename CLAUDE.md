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

## Hard rules

Each rule is paired with the check that enforces it in `docs/team.md` (Rules and checks).

- **No real money.** Run only on the in-process SimChain, a local chain or a testnet. Refuse to start with a Stripe key that is not `sk_test_…` or with a mainnet chain ID.
- **No admin keys.** Settlement contracts have no owner, pause, freeze, blacklist or upgrade proxy.
- **Secrets** come from environment variables only. Never read or print `.env*`.
- **Money** is a token amount in base units, as a decimal string, plus a token identifier. No floats.
- **Signed messages.** Every state-changing message from an agent is an EIP-712 signature checked against the agent's address and scope. Operators relay messages; they never author them.
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
pnpm snap                       # scenario fixtures vs .expect.md snapshots (placeholder until T-005)
pnpm snap --update <name>       # regenerate a snapshot; review the diff before committing
pnpm demo                       # recorded mode: no keys needed (placeholder until T-013)
pnpm demo --live                # live judges (needs two model-family keys)
forge test                      # contracts (from Phase 2)
```

## Working as a team of agents

- Pick up work only through a task file in `docs/tasks/`. Restate the task's intent in your own words before writing code.
- Work in your own git worktree and branch (`t-<id>-<slug>`). Keep PRs small, with ordered commits.
- Stay inside the paths the task lists. If you need to touch another lane's files, write that in the task's Handoff section and stop.
- Before you hand off:
  - add or update fixtures;
  - run `/verify`;
  - fill in the task's Evidence and Handoff sections;
  - open a PR.
- **Human gates:** ADRs, schema changes, contract code, defense changes, and any irreversible action (deploys, force pushes, key handling) wait for Rafa's approval.
- Use the role subagents in `.claude/agents/` and the commands in `.claude/commands/`. Process details are in `docs/team.md`.

## Map

`docs/decisions-today.md` records decisions D1–D9 (decided October 30, 2026; D4 deferred to Phase 2) and the open ones (D10–D12), and `docs/reviews/` the adversarial review behind them. Read both first.

The other docs: `PRD.md`, `neutrality.md`, `architecture.md`, `judgment-and-defenses.md`, `api.md`, `demo.md`, `testing.md`, `team.md`, `plan.md`, `decisions/`, `tasks/`. Research is in `docs/research/`; open it only when a decision needs it.

## Vocabulary

club, rulebook, member, agent, mandate, commitment (offered → agreed), hold, delivery, acceptance, deterministic check, rubric criterion, sealed check, screen, panel, judge, verdict, judgment, escalation, appeal, adjudicator, bond, fallback adjudicator, default outcome, operator node, rules contract, escape hatch, rail, on-ramp, off-ramp, SimChain, receipt. Definitions are in `docs/architecture.md` under Glossary.
