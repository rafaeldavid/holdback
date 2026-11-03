# T-054: Anomaly rules and the CPU guard

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-052 (the collector's output); T-053 for the trailing series the spike rule reads
- **Paths this task may touch:** `scripts/costs/rules.mjs` (new), `tests/costs/rules.test.ts` (new), `tests/costs/fixtures/` (synthetic only), `config/costs.template.yaml` (threshold keys), `apps/demo-cloud/wrangler.op1.jsonc`, `apps/demo-cloud/wrangler.op2.jsonc`, `apps/early-access/wrangler.jsonc` (a `limits` block only), `docs/costs.md` (the rules table), `docs/tasks/T-054-cost-anomaly-rules.md`
- **Human gate:** no to build the rules or propose the limits. **Yes** to deploy the CPU limits: a redeploy of the Workers is Rafa's.
- **Status:** todo
- **Agent/session:** —

## Intent

Catch in a day what a monthly bill would show in a month: a runaway agent, a spend spike, a cap or quota about to bite, a relayer running out of gas, paid usage that should be zero, a renewal coming due. And give each Worker a CPU limit per invocation, the one brake Cloudflare offers on runaway Worker spend.

- Inputs: `reports/costs/*.json` (T-052), the thresholds in `reports/costs/budgets.yaml`, the register (T-051).
- Outputs: `rules.mjs`, which returns the rules that fired with their evidence; a proposed `limits.cpu_ms` per Worker.
- Non-goals: delivering alerts to Rafa (T-055), stopping anything automatically, Phase 9's pipeline alarms (T-047).

## Context

- `docs/costs.md`, "Anomaly rules": the eight rules and their starting thresholds (guessed).
- ADR-0028 (PR 138): a lane below 0.02 Sepolia ETH warns, pauses the faucet, then refuses writes.
- Cloudflare's CPU limit per invocation, set with wrangler's `limits` or in the dashboard, "to prevent accidental runaway bills or denial-of-wallet attacks" (documented, read 2026-11-03).
- The machine-speed demo: the World Durable Object runs CSV checks, signing and NaCl, so a limit set too low breaks deals (`docs/research/2026-11-03-sepolia-demo-settlement.md`, PR 138).

## Agent steps

1. **`rules.mjs`**: one function per rule in `docs/costs.md`, each reading its threshold from `budgets.yaml` (D31: parameters, not constants). Thresholds are integers: cents, basis points, wei, tokens. A rule whose input is missing reports "no data", which is itself shown, never silence.
2. **Runaway agent:** tokens per session per hour and list-price cost per branch per day, from the `claude-code` source.
3. **Spend spike:** a day above a multiple of the trailing 7-day median and above a floor, per provider.
4. **Caps and quotas near:** Anthropic month to date against each workspace limit in the register; the DeepSeek balance; Durable Object use against the Free tier's daily limits or the Paid plan's included amounts, whichever the register says is current.
5. **Relayer low:** each lane's balance against a floor, and runway in days at the trailing week's burn.
6. **Paid usage that should be zero, and new lines:** GitHub usage above $0; a Cloudflare product, an Anthropic workspace or a key that did not appear last month.
7. **Renewals:** dates from the register within a window.
8. **CPU guard:** read each Worker's CPU time per invocation over 7 days (GraphQL, through T-052's analytics source). Propose `"limits": { "cpu_ms": … }` per Worker at twice the measured p99, with a floor, in the wrangler files. Find out and record whether the limit applies to the World Durable Object's invocations too. Rafa approves; he or an agent with his go-ahead deploys (`docs/operations.md`, Deploy).

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/rules.test.ts` shows each rule firing on a synthetic series that crosses its threshold and staying silent on one that does not.
- [ ] A missing source or a missing threshold yields a "no data" result, shown by a test.
- [ ] Every threshold is read from the budgets file; a test with a changed threshold changes the outcome.
- [ ] The proposed CPU limits are in the wrangler files with the measured p99 in Evidence (measured); whether the limit covers the Durable Object is recorded in Decisions.
- [ ] After Rafa's deploy, `node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream` still settles a deal (measured).

## Out of scope

- Sending alerts (T-055), automatic stops, the agent pipeline's alarms (T-047), uptime checks (`docs/backlog.md`, "Reliable production maintenance").

## Evidence

## Decisions

## Handoff
