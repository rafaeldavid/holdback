# T-041: Intake and the quarantine: tickets, agent feedback and CI signals become triage records

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-040 (T-032's feedback route merged in PR 121)
- **Paths this task may touch:** `scripts/ops/intake.mjs` (new), `scripts/ops/quarantine.mjs` (new), `scripts/ops/read-raw.mjs` (new), `agent-ops/prompts/triager.md` (new), `agent-ops/schemas/` (only if a test shows a schema bug), `agent-ops/pipeline.md` (Inputs section), `tests/agent-ops/intake.test.ts` (new), `tests/agent-ops/quarantine.test.ts` (new), `docs/tasks/T-041-intake-quarantine.md`
- **Human gate:** no. A live triager run spends from the model key in the isolated environment (T-039); scripted runs need no key.
- **Status:** todo
- **Agent/session:** —

## Intent

Turn outside text into data the pipeline can act on without letting that text instruct any agent with write access (threat P1 in `agent-ops/gates.md`).

- Inputs: GitHub issues labeled `intake` and pull request comments; agent feedback free text from T-032's private store, read from an export file that T-032's triage script (`apps/demo-cloud/scripts/feedback.ts`) writes when Rafa or a deploy session runs it (this script holds no Cloudflare credential and no feedback key); CI signals (red `main`, a recurring flake, a budget hit).
- Output: `TriageRecord`s in `reports/agent-ops/intake/` (git-ignored) that match `agent-ops/schemas/triage-record.schema.json`. Nothing else leaves the quarantine.
- The roadmap lane needs no collector: the architect reads `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/decisions/` and the reviews' "Next steps" directly, because each reached `main` through a reviewed PR. The telemetry lane is T-042.
- Non-goals: writing task files from records (the architect's step), dispatch (T-048), milestone feedback requests (T-043).

## Context

- `agent-ops/pipeline.md` (Inputs, Quarantine, Records), `agent-ops/gates.md` (P1, P2, P11).
- `docs/judgment-and-defenses.md` threats T1 to T3; `packages/judgment/src/normalize.ts` (reuse, read-only); the judges' spotlighting with random delimiters and a canary.
- `fixtures/scenarios/attack.*`: the injection payloads the product already defends against.

## Acceptance criteria

- [ ] `intake.mjs` collects issues labeled `intake` and PR comments through `gh` and the feedback export file, deduplicates by fingerprint, and writes CI-signal records without a model. A fake `gh` and a fixture export drive `pnpm vitest run tests/agent-ops/intake.test.ts`; no network.
- [ ] `quarantine.mjs` normalizes the text, places it between random delimiters with a canary token, sends it to the triager with no tools, and keeps the output only if it matches the schema under Ajv 2020-12 strict. Invalid output is dropped and counted in `reports/agent-ops/intake/dropped.jsonl` (counts and reasons, no text).
- [ ] A test runs every `attack.*` payload under `fixtures/` through the quarantine with a scripted hostile triager that tries URLs, handles, markup, copied text and the canary in its fields; every attempt is dropped or stripped. A record never contains a run of 40 or more characters copied from the raw text (checked on every test record).
- [ ] `read-raw.mjs <sourceRef>` prints the original text once, fenced, capped at 4 KB, and logs that it was read; no other script writes raw text to a task file, brief, PR body or handoff.
- [ ] A security record is never written to a public place: the script prints only "security record for Rafa" plus its fingerprint.
- [ ] `--live` runs the Haiku triager on the fixture set and reports the drop rate (measured, in Evidence); `pnpm verify` passes without keys.

## Out of scope

- Public issue filing (T-032 keeps it out), a social reader (T-042, needs Rafa), sending any text to a non-Anthropic provider (P11 forbids it).

## Evidence

## Decisions

## Handoff
