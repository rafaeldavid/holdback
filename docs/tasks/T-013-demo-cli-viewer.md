# T-013: Narrated CLI, transcript renderer, static viewer, dry run

- **Lane:** demo
- **Phase:** 1
- **Depends on:** all Phase 1 tasks
- **Paths this task may touch:** `apps/demo/`
- **Human gate:** yes (dry run with Rafa)
- **Status:** in progress
- **Agent/session:** implementer; branch `t-013-demo-cli`

## Intent

Make the demo readable for an AI-lab audience: narration, transcripts, timeline viewer, and a dry run against the success criteria.

Restated (2026-10-31):

- Turn each demo beat into something a researcher can read without the docs: a narrated Markdown transcript, a machine-readable JSON trace, and one static HTML timeline viewer, all written to `demo/out/` by `pnpm demo` (all beats) or `pnpm demo --beat n` (one beat).
- Every narrated line states what happened and the number behind it (amount, milliseconds, model ID, hash prefix), names the actor by its cast name, and avoids marketing language. Recorded mode says "recorded verdicts" and says so at the top of each transcript.
- The viewer is a single HTML file with inline CSS, no scripts and no network: per beat a timeline, balances, the panel with pinned model IDs, one signed message collapsed by default, and neutrality events marked. A closing section states finality per mode, the residual risks from `docs/neutrality.md`, and what an AI lab could add.
- The renderer reads a small typed transcript interface (`apps/demo/src/transcript/`), not the beat runner directly, so it can be built and tested against a stand-in event source while T-012's runner (PR 45) is in flight. Each beat's transcript names its source: SimChain through T-012's runner, or the scripted stand-in, whose numbers are illustrative.
- `--live` refuses cleanly with a message that two model-family keys are needed. It reads no environment file.
- The dry run with Rafa is a human gate: prepare it (time-to-first-transcript on a fresh clone, the four comprehension questions with answers quoted from the transcripts) and leave it open.
- Non-goals: hosted deployment; live judges; editing `apps/demo/agents/` (T-012's lane); making each beat a scenario fixture (T-010's lane); beats 8 and 9 (optional, no runner yet); wiring the real runner before PR 45 merges.

## Context

- `docs/demo.md` (all sections).

## Acceptance criteria

- [ ] `pnpm demo`, `--live`, `--beat n`; writes `demo/out/<beat>.md`, `.json`, `index.html` (static, no network).
- [ ] Narration follows the rules in `docs/demo.md`; recorded mode says so.
- [ ] Viewer shows timeline, balances, panel (model IDs), signed message (collapsed), neutrality events.
- [ ] Closing section states residual risks and asks for AI labs.
- [ ] Dry run on a fresh clone: time-to-first-transcript measured; four comprehension questions answered by a reviewer from transcripts alone.

## Out of scope

- Hosted deployment.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
