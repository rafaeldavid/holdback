# T-041: Intake, the quarantine and triage: tickets, agent feedback and CI signals become tasks

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-040. T-032's feedback route merged in PR 121.
- **Paths this task may touch:** `scripts/ops/intake.mjs` (new), `scripts/ops/quarantine.mjs` (new), `scripts/ops/read-raw.mjs` (new), `agent-ops/prompts/triager.md` (new), `agent-ops/commands/triage.md` (new, inert until T-050), `apps/demo-cloud/scripts/feedback.ts` (a new `export` command only), `docs/decisions-today.md` (architect, through `/record-decision`: the D39 triage question), `agent-ops/schemas/` (only if a test shows a schema bug), `agent-ops/pipeline.md` (Inputs section), `tests/agent-ops/intake.test.ts` (new), `tests/agent-ops/quarantine.test.ts` (new), `docs/tasks/T-041-intake-quarantine.md`
- **Human gate:** yes for two things only. The first feedback export reads the operator's KV store with the Cloudflare token, so a deploy session runs it on Rafa's go-ahead. Any change to the agent-facing feedback notice is a publication. No for the rest. A live triager run spends from the capped `crow-agents` key (T-039); scripted runs need no key.
- **Status:** todo
- **Agent/session:** —

## Intent

Turn outside text into data the pipeline can act on, without letting that text instruct any agent with write access (threat P1 in `agent-ops/gates.md`). Then let the architect turn the data into work.

- **Inputs:**
  - GitHub issues labeled `intake`, and PR comments, read through `gh api` REST calls. These work in Claude Code cloud sessions too, where `gh issue` and `gh pr` answer 403.
  - Agent feedback, through an export file.
  - CI signals: a red `main`, a recurring flake, a budget hit.
- **Outputs:**
  - `TriageRecord`s in `reports/agent-ops/intake/` (git-ignored) that match `agent-ops/schemas/triage-record.schema.json`. Nothing else leaves the quarantine.
  - The architect's routing of each record: a task file, a backlog row, a decision entry, or close.
- **The roadmap lane needs no collector.** The architect reads `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/decisions/` and the reviews' "Next steps" directly, because each reached `main` through a reviewed PR.
- Non-goals: the telemetry lane (T-042), milestone feedback requests (T-043), dispatch and briefs (T-048).

## Context

- `agent-ops/pipeline.md` (stages 0 and 1, Inputs, Quarantine, Records), `agent-ops/gates.md` (P1, P11). PR 112, not merged yet.
- `docs/judgment-and-defenses.md` threats T1 to T3; `packages/judgment/src/normalize.ts` (reuse, read-only); the judges' spotlighting with random delimiters and a canary.
- `fixtures/scenarios/attack.*`: the injection payloads the product already defends against.
- T-032 and D39:
  - an agent's report is shared with the operator that receives it;
  - sealed fields open only with the operator's key, in `apps/demo-cloud/scripts/feedback.ts`;
  - that script today has `public-key`, `list`, `show`, `reply` and `set` (measured).

## Acceptance criteria

- [ ] `feedback.ts export` writes a JSON Lines file of unsealed reports. It never opens a sealed field, and never writes a signer key or an IP. It runs where the KV access is: a deploy session, or Rafa's laptop. On option B, it writes to `/srv/crow/intake/` (created by T-039's `vm-users.sh`), which the `agent` user can read. Tested on a fixture store.
  - Until the D39 decision below allows more, the export holds only ID, kind, fingerprint, status and date. The limit is in the export, not only in `intake.mjs`, because anything a build session reads goes to Anthropic with the session.
  - Once allowed, it adds summary, observed, expected and request ID.
- [ ] Decide, after a research pass, whether the clear text of a report may go to the operator's own triage model (Anthropic) under D39. The architect records it with `/record-decision` (T-036), or by hand if T-036 has not merged. If the answer needs new wording in the agent-facing notice (`site/llms.txt`, `docs/api.md`), that change goes to Rafa as a publication.
- [ ] `intake.mjs` collects issues labeled `intake` and PR comments through `gh api` REST, reads the feedback export, deduplicates by fingerprint, and writes CI-signal records without a model. A fake `gh` and a fixture export drive `pnpm vitest run tests/agent-ops/intake.test.ts`, with no network.
- [ ] `quarantine.mjs` normalizes the text, places it between random delimiters with a canary token, sends it to the triager with no tools, and keeps the output only if it matches the schema under Ajv 2020-12 strict. Invalid output is dropped and counted in `reports/agent-ops/intake/dropped.jsonl` (counts and reasons, no text).
- [ ] A test runs every `attack.*` payload under `fixtures/` through the quarantine with a scripted hostile triager. The triager tries URLs, handles, markup, copied text and the canary in its fields, and every attempt is dropped or stripped. No record contains a run of 40 or more characters copied from the raw text (checked on every test record).
- [ ] `read-raw.mjs <sourceRef>` prints the original text once, fenced, capped at 4 KB, and logs that it was read. No other script writes raw text to a task file, brief, PR body or handoff.
- [ ] A security record is never written to a public place. The script prints only "security record for Rafa" and its fingerprint.
- [ ] `agent-ops/commands/triage.md` is the architect's stage 1, inert until T-050 moves it into `.claude/commands/`. It works as follows:
  - The architect reads records only, never raw text.
  - It routes each record to a task file, a backlog row, a decision entry or a close.
  - It orders work by the demo path, then severity, then age.
  - It writes `Origin: untrusted (<record fingerprint>)` in a task file made from a ticket, feedback or a social record.
- [ ] `--live` runs the Haiku triager on the fixture set and reports the drop rate (measured, in Evidence). `pnpm verify` passes without keys.

## Out of scope

- Public issue filing (T-032 keeps it out).
- A social reader (T-042, needs Rafa).
- Sending any text to a non-Anthropic provider, which P11 forbids.

## Evidence

## Decisions

## Handoff
