# Reconciliation

Three drafts, all from 2026-11-03, all from the same sources and constraints:

- **Opus 5.5:** the first draft of these files.
- **Fable 5.1:** written at max effort and read-only, and returned as a report.
- **PR 108:** an earlier, stopped attempt (branch `claude/agent-ops-design-46b9a8`). It had its own Opus and Fable reconciliation.

Where they converged, the choice is likely robust. Where they differed, the chosen option is below, with the reason.

## Converged

- **Isolation:** a sandboxed session per task, with the Agent tool's worktree plus a guard hook as the local fallback.
- **Second family:** reached over plain HTTP, with no tools, through the judges' provider. No second-family agentic CLI.
- **Readiness:** a script decides, not a model. The queue lives in git.
- **Lanes:** 3 until T-034 lands.
- **Control plane:** never auto-merged.
- **Disagreements:** settled by a reproduction, never by a vote or a re-roll.
- **Reviewer and verifier:** the reviewer loses Write and Edit; the verifier is Sonnet 5.5.
- **Flakes:** one rerun, only for a listed flake.

## Disagreements

| Question | Opus 5.5 | Fable 5.1 | PR 108 | Chosen, and why |
| --- | --- | --- | --- | --- |
| Where it lives | `agent-ops/` | `docs/pipeline/` | `agent-ops/` | `agent-ops/`, which Rafa asked for. `docs/team.md` stays the live process, with no second Rules and checks table |
| Triage model | Haiku | Sonnet | Haiku, no tools, schema output | **PR 108, as the brief asked.** No tools and the schema contain the triager; model strength does not. Haiku's measured output overruns show up as dropped records, counted during the shadow week |
| Coordinator | Opus | Sonnet and scripts | a stateless tick, with Haiku running it | **PR 108.** A long-running coordinator paused at the weekly token limit on 2026-11-01 (measured), and state derived fresh on every tick cannot go stale |
| Reviewer | Opus for all code | one tier above the author | Opus, a fresh session | **Never the author's model:** Opus reviews Sonnet's work, Fable reviews Opus's |
| Tier 2 author | Opus | Fable | Opus, after fixtures written first by another session | **Opus with fixtures first.** The strongest model sits on the checking side |
| Tier 2 paths | crypto, schemas, money, judgment | adds all of `core`, `spec`, `adjudicator`, `operator/src` | adds `pnpm-lock.yaml` | **The union.** The lockfile is supply chain |
| Lane lock | the lane is idle | a draft PR | a pushed `t-*` branch | **PR 108.** CI runs on every pull request but only on pushes to `main` (measured, `ci.yml`), so a branch claim costs no CI run |
| Branch updates | merge `main` in | rebase | merge | **Merge,** Rafa's standing rule |
| Finding nobody refutes | stands until a test refutes it | the verifier tries the reproduction once | stands until a counter-test; two refutations go to Rafa | **Merged.** The verifier runs the reproduction once. Two refuted findings, or two abstentions, on one PR go to Rafa |
| How the second family reports | a CI status | a comment posted by a script | not specified | **A CI status.** Agents share one account and can post a "PASS" comment; a base-branch workflow's status cannot be forged (inferred) |
| ADR review | blocks | blocks | advisory | **Advisory.** Rafa accepts ADRs (`architect.md`), so the critique is his input |
| Activation switch | `status:` in a hand-merged PR | a repository variable | `AGENT_OPS=on` and `STATUS=active`, failing closed | **PR 108.** The authoritative switch lives outside the repo, so the agents cannot write it |
| Tier 3 enforcement | a fleet identity plus code-owner review | CODEOWNERS advisory | a bot identity | **Opus.** Agents act as Rafa and the ruleset needs 0 approvals (measured), so only code-owner review enforces it, and tier 3 changes rarely |
| Review-theater control | canaries | an agreement metric and a 1-in-5 audit | a per-PR footer and an agreement summary | **Canaries, agreement and the footer.** The audit duplicates them at Fable's price |
| Verifies per machine | 2 | 1 | 1 | **1.** Two in parallel already push tests past their timeouts (measured); the Opus draft contradicted that measurement |
| Lanes after T-034 | 5 | 6 | not set | **5.** All guessed; the lower one stays until the metrics measure queueing |

## Taken from PR 108

- **The two JSON schemas**, extended with telemetry sources, a `signal` field, a `route` field, the `security`, `friction` and `deprecation` kinds, and a ban on handles. Both compile under Ajv 2020 in strict mode (measured).
- **The `STATUS` file** and the fail-closed pair of switches.
- **The quarantine:**
  - normalization with `packages/judgment/src/normalize.ts`;
  - spotlighting and a canary token;
  - no raw text in task files, briefs, PR bodies or handoffs;
  - the one-shot reader.
- **The rule that untrusted intake touching tier 2 or 3 waits for Rafa.**
- **The threats table** (P1 to P10), extended with P11 telemetry and P12 scope.
- **The tick runner, lander and daily-log job** as Haiku roles, the work-in-progress caps and the guessed budgets.
- **The alarms that pause dispatch**, the per-PR footer and the shadow week.
- **Activation additions:** the test that feeds every `attack.*` payload to triage.
- **Flake rules:** entries expire after 14 days, and a flake firing twice a day pauses its lane.
- **The known gap** that a session does not re-check the switch mid-task.

## Added after the drafts

- **Usage telemetry as a fourth input lane** (Rafa, through the coordinating session): website, social, API and onchain, each with an owner, a cadence, a rule that opens a record, and a retention limit. Aggregates only, kept private, and never sent to a non-Anthropic provider ([pipeline.md](pipeline.md)).
- **Guard patterns:** command substitution, `xargs`, `eval` and `find -exec` added to the guard hook's list (Rafa, through the coordinating session).

## Corrections from the cross-check

- **Transport path.** The Opus draft cited `packages/judgment/src/providers/` as the transport. The live transport is `apps/adjudicator/src/providers/live.ts` (measured).
- **Deny list.** Fable and PR 108 proposed additions to the deny list. They are adopted as proposed gates only; `.claude/` is out of scope here.
- **Fallback prompts.** The cause of the 2026-11-03 worktree prompts is not explained in the sources, so whether the local fallback removes them is guessed.
