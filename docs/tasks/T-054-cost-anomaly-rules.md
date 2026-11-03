# T-054: Anomaly rules and the CPU guard

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-052 (the collector's daily files, which hold the trailing series every rule reads); T-213 (Sepolia settlement) live, with `SETTLEMENT` set to `sepolia`, for the relayer rule and the CPU guard only
- **Paths this task may touch:** `scripts/costs/rules.mjs` (new), `scripts/costs/collect.mjs` (a `--cpu-report` flag only), `tests/costs/rules.test.ts` (new), `tests/costs/fixtures/` (synthetic only), `config/costs.template.json` (threshold keys), `apps/demo-cloud/wrangler.op1.jsonc`, `apps/demo-cloud/wrangler.op2.jsonc`, `apps/early-access/wrangler.jsonc` (a `limits` block only), `docs/costs.md` (the rules table), `docs/tasks/T-054-cost-anomaly-rules.md`
- **Human gate:** no to build the rules or propose the limits. **Yes** to deploy the CPU limits: a redeploy of the Workers is Rafa's.
- **Status:** todo
- **Agent/session:** —

## Intent

Catch in a day what a monthly bill would show in a month: a runaway agent, a spend spike, a cap or quota about to bite, the relayer's funding lane running dry, paid usage that should be zero, a renewal or a token expiry coming due. And give each Worker a CPU limit per invocation, the one brake Cloudflare offers on runaway Worker CPU.

- Inputs: the collector's daily files (T-052), the thresholds in `budgets.json`, the register (T-051).
- Outputs: `rules.mjs`, which returns the rules that fired with their evidence; a proposed `limits.cpu_ms` per Worker.
- Non-goals: delivering alerts to Rafa (T-055), stopping anything automatically, the agent-ops phase's pipeline alarms (T-047).

## Context

- `docs/costs.md`, "Anomaly rules": the eight rules and their starting thresholds (guessed).
- The Sepolia world (`apps/demo-cloud/src/world.ts`, measured): a deal lane below 0.01 Sepolia ETH gets 0.03 from the funding lane; a lane that cannot pay answers `relay_refused`. So the funding lane is the one to watch.
- Cloudflare's CPU limit per invocation, set with wrangler's `limits` or in the dashboard, "to prevent accidental runaway bills or denial-of-wallet attacks" (documented, read 2026-11-03). It does not cap Durable Object requests, duration or rows, the demo's main cost drivers (inferred).
- The World Durable Object runs CSV checks, signing, NaCl and live judge calls, so a limit set from a quiet week can break a heavy deal.

## Rafa's steps

1. Set the thresholds in `budgets.json` after reading the first report (T-053) (human, 10 min, guessed).
2. For the CPU guard, after 7 days on Sepolia: approve this task's changes as in T-052 (step 7), then, in the clone, run `node scripts/costs/collect.mjs --cpu-report`, which prints only each Worker's p99 and maximum CPU milliseconds per invocation, and give those numbers to the agent (human, 5 min). They carry no billing figure.
3. Approve the proposed CPU limits, then deploy them yourself or give an agent the go-ahead (`docs/operations.md`, Deploy) (human).

## Agent steps

1. **`rules.mjs`**, importing only `node:` modules like the rest of `scripts/costs/` (T-052): one function per rule in `docs/costs.md`, each reading its threshold from `budgets.json` (D31: parameters, not constants). Thresholds are integers: cents, basis points, wei, tokens. A rule whose input is missing reports "no data", which is itself shown, never silence.
2. **Runaway agent:** tokens per session per hour and list-price cost per branch per day, from the `claude-code` source.
3. **Spend spike:** a day above a multiple of the trailing 7-day median and above a floor, per provider, from the daily files.
4. **Caps and quotas near:** Anthropic month to date against each workspace limit in the register; the DeepSeek balance in its currency; Durable Object use against the Free tier's daily limits or the Paid plan's included amounts, whichever the register says is current.
5. **Relayer:** the funding lane against a floor and in days of runway at the trailing week's burn. A deal lane fires only when it reads under 0.01 Sepolia ETH twice, two minutes apart: the world tops lanes up at most once a minute, so one low read may be a lane that just paid.
6. **Paid usage that should be zero, and new lines:** GitHub usage above $0; a Cloudflare product, an Anthropic workspace or a key that did not appear last month.
7. **Renewals and expiries:** dates from the register within a window, tokens included.
8. **CPU guard**, after T-213 is deployed and Workers Paid is confirmed (T-051, step 5): add the `--cpu-report` flag to `collect.mjs` (GraphQL, through T-052's analytics source; it prints CPU milliseconds only), take the numbers from Rafa's step 2, and run a rubric deal on the demo CSV and on the largest deliverable the demo accepts to measure the heaviest invocation. Propose `"limits": { "cpu_ms": … }` per Worker at twice the larger of the measured p99 and the heaviest invocation. Find out and record whether the limit applies to the World Durable Object's invocations too.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/rules.test.ts` shows each rule firing on a synthetic series that crosses its threshold and staying silent on one that does not; the relayer rule stays silent on a deal lane whose second read, two minutes later, shows a top-up.
- [ ] A missing source or a missing threshold yields a "no data" result, shown by a test.
- [ ] Every threshold is read from the budgets file; a test with a changed threshold changes the outcome.
- [ ] The proposed CPU limits are in the wrangler files, with the measured p99 and heaviest invocation in Evidence (measured); whether the limit covers the Durable Object is recorded in Decisions.
- [ ] After Rafa's deploy, `node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream --rubric` and a deal on the largest accepted deliverable both settle (measured).

## Out of scope

- Sending alerts (T-055), automatic stops, the agent pipeline's alarms (T-047), uptime checks (`docs/backlog.md`, "Reliable production maintenance").

## Evidence

## Decisions

## Handoff
