# Reconciliation

Three drafts produced this design. All three date from 2026-11-03 and used the same sources and constraints.

- Opus 5.5 wrote the first draft of these files.
- Fable 5.1 wrote an independent design at max effort, without write access, and returned it as a report.
- An earlier attempt, PR 108 (branch `claude/agent-ops-design-46b9a8`), reconciled its own Opus and Fable drafts before it stopped.

Where the drafts agreed, the design keeps the shared choice. Where they differed, the table below records each decision and its reason.

## Points of agreement

- Each task runs in a sandboxed session. The local fallback is the Agent tool's worktree with a guard hook.
- The second family receives requests over plain HTTP, with no tools, through the judges' client. The design uses no second-family agentic CLI.
- A script decides when a task is ready. Git holds the queue.
- The pipeline runs three lanes until T-034 lands.
- The pipeline never auto-merges changes to its own rules.
- A reproduction settles each disagreement. The pipeline never takes a vote or reruns a reviewer.
- The reviewer has no Write or Edit access, and the verifier uses Sonnet 5.5.
- CI reruns a failed test once, and only if the test is on the known flakes list.

## Points of disagreement

| Question | Opus 5.5 | Fable 5.1 | PR 108 | Decision and reason |
| --- | --- | --- | --- | --- |
| Location | `agent-ops/` | `docs/pipeline/` | `agent-ops/` | `agent-ops/`, as Rafa asked. `docs/team.md` remains the live process and keeps the only Rules and checks table. |
| Triage model | Haiku | Sonnet | Haiku with no tools and schema output | PR 108, matching the brief. The missing tools and the schema contain the triager, so model strength adds little. If Haiku exceeds output limits, as it did in judge runs (measured), the quarantine drops the record and the shadow week counts it. |
| Coordinator | Opus | Sonnet with scripts | A stateless script run by Haiku | PR 108. A long-running coordinator stopped at the weekly token limit on 2026-11-01 (measured). A script that rebuilds its state on every run cannot hold stale state. |
| Reviewer | Opus for all code | One tier above the author | Opus in a fresh session | The reviewer is never the author's model. Opus reviews Sonnet's work, and Fable reviews Opus's work. |
| Tier 2 author | Opus | Fable | Opus, after a separate session writes the tests | Opus, after the fixture-author writes the tests. The strongest model reviews instead of writing. |
| Tier 2 paths | Crypto, schemas, settlement and judgment | Adds all of `core`, `spec`, `adjudicator` and `operator/src` | Adds `pnpm-lock.yaml` | The union of all three. The lockfile is a supply-chain risk. |
| Task claim | An idle lane | A draft pull request | A pushed `t-*` branch | PR 108. CI runs on every pull request but only on pushes to `main` (measured, `ci.yml`), so a branch claim starts no CI run. |
| Branch updates | Merge `main` into the branch | Rebase | Merge | Merge, which is Rafa's standing rule. |
| Unrefuted findings | The finding stands until a test refutes it. | The verifier tries the reproduction once. | The finding stands until a counter-test, and two refutations go to Rafa. | A combination. The verifier runs the reproduction once. Two refuted findings or two abstentions on one pull request go to Rafa. |
| Second-family channel | A CI status | A comment posted by a script | Not specified | A CI status. All agents share one account, so any agent can post an approval comment. A status from a workflow on `main` cannot be forged (inferred). |
| ADR review | Blocking | Blocking | Advisory | Advisory. Rafa accepts ADRs (`architect.md`), so the critique serves as his input. |
| Activation switch | A `status:` line changed in a hand-merged pull request | A repository variable | `AGENT_OPS=on` and `STATUS=active`, both failing closed | PR 108. The authoritative switch lives outside the repository, so the agents cannot change it. |
| Tier 3 enforcement | A bot identity and code-owner review | Advisory CODEOWNERS | A bot identity | Opus. Agents act as Rafa and the ruleset requires no approvals (measured), so only a required code-owner review enforces tier 3. Tier 3 changes are rare, so the review adds little delay. |
| Review-quality control | Canaries | An agreement metric and an audit of one PASS in five | A per-PR footer and an agreement summary | Canaries, the agreement metric and the footer. The audit duplicates them at Fable's cost. |
| `pnpm verify` runs per machine | Two | One | One | One. Two parallel runs push tests past their timeouts (measured). The Opus draft contradicted that measurement. |
| Lanes after T-034 | Five | Six | Not set | Five. All three values are guesses. The design keeps the lower value until metrics measure CI queueing. |

## Taken from PR 108

- The two JSON schemas. This design extends them with telemetry sources, a `signal` field, a `route` field, the `security`, `friction` and `deprecation` kinds, and a rule that rejects handles. Both schemas compile under Ajv 2020 in strict mode (measured).
- The `STATUS` file and the pair of switches that fail closed.
- The quarantine: normalization with `packages/judgment/src/normalize.ts`, random delimiters, a canary token, the ban on raw text in task files, briefs, pull request bodies and handoffs, and the one-shot reader.
- The rule that Rafa approves any task from untrusted input that touches tier 2 or tier 3.
- The threat table (P1 to P10). This design adds P11 for telemetry and P12 for scope.
- The tick runner, the lander and the daily-log job as Haiku roles, the work-in-progress limits and the guessed budgets.
- The alarms that pause dispatch, the per-PR footer and the shadow week.
- The activation test that runs every `attack.*` payload through triage.
- The flake rules: each entry expires after 14 days, and a flake that fails twice in a day pauses its lane.
- The known gap that a running session does not recheck the switch.

## Additions after the drafts

- Usage telemetry became the fourth input lane at Rafa's request, relayed by the coordinating session. It covers the website, social posts, the API and the chain. Each source has an owner, a cadence, a rule that opens a record and a retention limit. Telemetry holds aggregates only, keeps them private, and sends nothing to non-Anthropic providers ([pipeline.md](pipeline.md)).
- At Rafa's request, the operator adds feedback requests at key deal milestones for agents whose owners opt in. It asks before signing, after a stage completes, or on a sample of milestones and errors. Ratings become telemetry, and free text enters the quarantine ([pipeline.md](pipeline.md)).
- The guard hook now also blocks command substitution, `xargs`, `eval` and `find -exec`, at Rafa's request, relayed by the coordinating session.
- On 2026-11-05 Rafa asked for "agent / customer usage simulation, with set of diverse needs informed by continous market feedback in staging environment pre-merge". The design adds a scripted tier as a fourth required check, a model tier on the VM, per-PR worlds and a shared Sepolia staging world, and a catalogue that market feedback keeps current ([pipeline.md](pipeline.md#usage-simulation), T-061, T-062).
- The same day Rafa asked that "tickets" also come from "agent crawlers looking for bugs in production environment, as well as continuous security audits informed by market security events". The design adds production crawlers and a security watch with targeted red-team audits to the Tickets lane (T-063, T-064).

A Fable 5.1 design pass at max effort wrote both amendments: `docs/research/2026-11-05-simulation-and-watch.md`, with ten open questions for Rafa. It chose between these options:

| Question | Options | Decision and reason |
| --- | --- | --- |
| Where the simulation gates | A CI status; a reviewer's precondition | Both. The scripted tier is deterministic and free, so it runs in CI as `simulate`. Live models are stochastic and cost money, so the model tier blocks only on deterministic facts (an invariant violation or a measured regression), and the reviewer reads its record. |
| What staging is | Per-PR worlds; one shared Sepolia world | Both. Per-PR worlds on SimChain, anvil and workerd give the gate. One Sepolia staging world, separate from D49's demo world, catches real block timing, RPC providers and Cloudflare limits before each deploy. |
| Where the crawler runs | GitHub Actions; the agents' VM | The VM. Actions schedules skipped two hourly runs during a GitHub incident on 2026-11-04 (measured, T-060), when the crawler matters most. |
| The harness's tier | Tier 3, as T-044 puts gate-defining files; tier 2 | Tier 2, with the pass rules in tier 3 (`ops.yaml`). A second family still reads every harness change. Rafa may move it to tier 3. |
| Catalogue entries from untrusted sources | Rafa's approval line; the normal tier 1 review | Tier 1 review. The architect writes entries from schema-bounded records, never from raw text, and a simulated party holds only a test key. Rafa can require his line. |
| A security audit that breaks a defense | A public fixture; a private fix | A private fix. Nothing is pushed until the fix ships in GitHub's security-advisory fork, as `SECURITY.md` promises, and the fixture lands with the fix. |

## Corrections

- The Opus draft cited `packages/judgment/src/providers/` as the HTTP client. The live client is `apps/adjudicator/src/providers/live.ts` (measured).
- Fable and PR 108 proposed additions to the deny list. This design lists them as proposed controls and does not apply them, because `.claude/` is outside this task's scope.
- The sources do not explain the worktree prompts of 2026-11-03, so the effect of the local fallback is a guess.
