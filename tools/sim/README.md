# Agent simulation (T-021)

Model agents of different sizes play buyers and sellers against a local Holdback world through the HTTP API, the way an outside developer's agent would. Each run gets its own world, so runs never share state. Afterwards `sim:check` recomputes the run's invariants from the settlement layer's own record. The sim is for exploration, not CI: a finding worth keeping becomes a deterministic fixture.

Nothing here is real: SimChain, the test token tUSD (6 decimals), test keys, and **fake judges** (a panel passes any work unless it contains `FAIL-ME`, and never suspects injection; deterministic checks are real). Simulated parties are never adjudicators. Unlike `pnpm sim`, a run's world keeps each party's keys private: they derive from a random per-world secret, appear only in `world.json` and that party's brief, and the sim service serves none (`publishSecrets: false`).

## Pieces

| | |
| --- | --- |
| `catalogue.json` | Jobs (dataset, translation, code fix, research brief) with terms a party can propose; behaviour profiles (honest, sloppy, impatient, adversarial with tactics per role); model sizes; suggested pairings |
| `briefs/` | The brief template per role (`buyer.md`, `seller.md`, shared `common.md`). A brief gives the model only outsider knowledge: the allowed docs (`README.md`, `docs/quickstart.md`, `docs/api.md`, `examples/`), this world's public endpoints, its own account, the counterparty's address, its job, its profile, and how to report |
| `pnpm sim:world <run-id>` | Starts an isolated world on free ports (SimChain, two operators, three fake-judge adjudicators, a sim service) with fresh party accounts whose keys derive from a random per-world secret, and writes `runs/<run-id>/world.json`. The sim service's `GET /` lists addresses and encryption public keys only. Keeps running. `--parties a,b,c` names the parties (default `buyer-1,seller-1,buyer-2,seller-2`) |
| `pnpm sim:brief <run-id> <party> ...` | Renders a party's brief and saves it to `runs/<run-id>/briefs/<party>.md` |
| `bin/mail.ts` | The agent-to-agent channel: `send` and `read [--wait n] [--out <file>]` over `runs/<run-id>/mailbox/<party>/`. `--out` saves the body to a file exactly as sent, so a party never transcribes a signed offer. Unauthenticated, like any channel outside the protocol |
| `pnpm sim:check <run-id>` | Checks the run's invariants against the live world, writes `runs/<run-id>/check.json` and `audit.json`, exits 1 on a violation. `--audit <file>` checks a saved audit instead (writes nothing) |
| `pnpm sim:stop <run-id>` | Stops the run's world |

`runs/` is git-ignored. `world.json` has a `coordinator` section (the audit endpoint, the report and check paths) that never goes into a brief.

## Run a batch (the coordinator)

The coordinator is a Claude Code session at the repository root. Subagents cannot spawn subagents, so the coordinator spawns every party itself.

1. **Build once:** `pnpm install && pnpm build`.
2. **Start one world per pair**, each in the background (Bash with `run_in_background`), with a fresh run id per run:

   ```sh
   pnpm sim:world dataset-honest-1
   ```

   Wait until `tools/sim/runs/dataset-honest-1/world.json` exists. Start as many runs as you like at once; each takes its own free ports and accounts. Keep one buyer–seller pair per world: `POST /advance` moves that whole world's clock, so a pair sharing a world with another would move the other's deadlines.
3. **Render the briefs**, one per party, from a pairing in `catalogue.json` (or your own mix of job, profile and model):

   ```sh
   pnpm sim:brief dataset-honest-1 buyer-1  --role buyer  --with seller-1 --job dataset --profile honest      --model haiku
   pnpm sim:brief dataset-honest-1 seller-1 --role seller --with buyer-1  --job dataset --profile adversarial --model opus
   ```

4. **Spawn one subagent per party, all in one message** so the two sides run at the same time. For each party, call the Agent tool with:
   - `model`: the party's model (`haiku`, `sonnet`, `opus` or `fable`);
   - `subagent_type`: `general-purpose` (it needs Bash for curl and node), no worktree isolation (it must reach the world on 127.0.0.1 and run `examples/sign.ts`);
   - `prompt`: the whole text of `tools/sim/runs/<run-id>/briefs/<party>.md`, unchanged. Add nothing about the sim's internals, the audit endpoint, `sim:check` or the other party's profile.

   Each party writes its report to `tools/sim/runs/<run-id>/reports/<party>.json` and returns it as its final message.
5. **Check, then stop:** when every party has reported (or given up), run `pnpm sim:check <run-id>` while the world is still up, read `check.json`, then `pnpm sim:stop <run-id>`.
6. **Triage**, in this order:
   - a **violation** (exit 1) is a protocol or settlement bug, or a sim bug: reproduce it from `audit.json` (the journal holds every signed submission in order) and fix or file it first;
   - a **finding** is a party whose report disagrees with the record or with its counterparty: usually a misreading, sometimes a doc that misleads;
   - **friction** in the reports is usability evidence for the quickstart and API docs; compare it across model sizes.

## What sim:check proves

It reads the settlement layer's audit (genesis, the chain's ledger, the journal of accepted signed submissions, the hash-chained event log) and what every operator serves to any party (state, events, judgment record, balances). It trusts no party report, no operator's state view, no unsigned event field and no SimChain helper. It replays each commitment's state machine from the log, with deadlines taken from the signed terms, and each signed message in the journal can back only one event:

| Invariant | How it is computed |
| --- | --- |
| `log-integrity` | Every event's `seq` is its position, it links to the previous hash, it hashes (RFC 8785, keccak256) to its own hash, and no event is earlier than the one before it |
| `conservation` (per token) | Genesis balances, bonds and faucet mints, plus every posting replayed from the log, equal the chain's ledger account by account; the ledger sums to what was minted; no account goes negative; every amount is in the world's token |
| `within-terms` | Every event must be allowed by the replayed state and its deadlines (for example a fallback only after `judgeBy`, a default only from fallback judging after `fallbackBy` or from an escalation after its decision deadline, a reclaim only from `Held` after `deliverBy`). Each money-moving event is re-derived from the seller-signed terms, the signed messages and the club rulebook and must match its postings exactly: a hold of price plus fee backed by a buyer-signed funding authorization; a release or refund right after a decision signed by the sitting adjudicator (primary, then fallback after a fallback trigger, appeal only after an escalation) whose signed role, outcome and judgment record match the event (price to the payee, fee to the decider); an early accept signed by the buyer; a settlement signed by both with payouts summing to the price; appeal bonds at least the rulebook rate, the appeal fee, and their return or forfeit according to the verdict the signed appeal decision implies (never the event's own label); bond payouts only for an overturn (required; to the wronged party, at most the price) or a default (to the seller, at most the rulebook's compensation, from the appeal adjudicator after an escalation and otherwise the primary and fallback). The content key reaches the buyer only once it has paid |
| `terminal-or-explained` | Using the replayed state and the terms' deadlines, each commitment is final (settled, expired, or released or refunded past its appeal window), or open with a stated reason: who acts next and until when, or which permissionless trigger is now due. The escrow, appeal bond and appeal fee accounts hold exactly what the state says |
| `records-match` (D26) | Every operator serves the same events (by hash) as the log, the replayed escrow and appeal state, the same finality, a judgment record whose hash matches the last signed decision, and the replayed balances; so the buyer and the seller read the same record wherever they look |

Party reports add **findings** only: a claimed final state that differs from the record, a role the terms do not give that party, or two parties that disagree.

The proof that it catches violations is in `check.test.ts` (one SimChain deal per money path: release, refund, early accept, settlement, appeal overturned and upheld, reclaim, default, open offer) and `world.test.ts` (a scripted pair from `examples/` in one of two parallel worlds): a ledger with units moved off the record, units minted from nothing, a forged posting with a valid hash chain and a ledger to match, a forged release with no signed decision, an edited event, an operator hiding an event, operators agreeing on a state the log does not reach, a refund that left the money in escrow, a default forged on a delivered deal (no fallback, backdated), a default before `fallbackBy`, an upheld appeal relabelled overturned with the bond returned, a decision event whose role and record differ from the signed decision, a default payout from an adjudicator who is not liable, and an appeal decision with no signed message of its own each fail the expected invariant.

## Promote a finding to a fixture

1. Reduce the run to the few steps that matter, from `audit.json` (`journal`: the signed submissions in order; `log`: the events) and the party's `actions`.
2. Write `fixtures/scenarios/<prefix>.<name>.scenario.yaml` with the prefix that fits (`attack.` for an adversarial party, `error.` for a refusal, `neutrality.` for a party or actor that vanished, `todo.` for a gap not yet fixed); see `docs/testing.md` and `_example.scenario.yaml`.
3. `pnpm snap --update <name>`, review the `.expect.md`, and commit both with the run id in the commit message.
4. For a usability finding with no protocol behaviour to pin, add a row to `docs/backlog.md` instead.

## Limits

- Fake judges: a panel's verdict says nothing about the work's quality. Fake judges never suspect injection, and a panel passes any work against any rubric unless the work contains `FAIL-ME`. Only deterministic checks show real acceptance behaviour, and only a live-judge run shows whether a judge would catch an injected instruction (batch 1, F3).
- The sim service serves no secret key in a run's world: `GET /`, `GET /clock`, the controls and every error carry none, and `POST /accounts` hands a fresh spare account's keys to its caller only (`world.test.ts` scans every route for the parties' keys). Keys derive from a per-world secret, so a party's name or the run id does not give its key.
- Nothing else enforces a party's limits; they are rules in its brief. The sim service has no access control: any party could call `POST /advance`, `POST /accounts` or the `/adjudicators` controls (briefs forbid all but `/advance`; out of scope for T-023). The run directory (including `world.json`, which holds every party's keys, and the other mailboxes) is readable by any subagent. Briefs forbid `world.json`, the briefs, reports and audit files and other parties' directories and mailboxes. `sim:check` does not detect a party that ignores this, though a signature by the wrong key would still fail its counterparty's checks. Read each party's `actions` for signs of it.
- `sim:check` needs the live world (it reads the operators); run it before `sim:stop`.
- Claude-family models only until keys for other families are available.
