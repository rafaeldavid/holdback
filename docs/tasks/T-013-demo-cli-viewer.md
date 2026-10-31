# T-013: Narrated CLI, transcript renderer, static viewer, dry run

- **Lane:** demo
- **Phase:** 1
- **Depends on:** all Phase 1 tasks
- **Paths this task may touch:** `apps/demo/`
- **Human gate:** yes (dry run with Rafa)
- **Status:** review (stand-in source; SimChain runner wiring waits on PR 45; dry run with Rafa open)
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

- [x] `pnpm demo`, `--live`, `--beat n`; writes `demo/out/<beat>.md`, `.json`, `index.html` (static, no network). (`--live` refuses until keys exist; the source is the stand-in until PR 45.)
- [x] Narration follows the rules in `docs/demo.md`; recorded mode says so.
- [x] Viewer shows timeline, balances, panel (model IDs), signed message (collapsed), neutrality events. (Model IDs are placeholders until the Bench registrations land.)
- [x] Closing section states residual risks and asks for AI labs.
- [ ] Dry run on a fresh clone: time-to-first-transcript measured; four comprehension questions answered by a reviewer from transcripts alone.

## Out of scope

- Hosted deployment.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

### Stand-in source (2026-10-31, branch `t-013-demo-cli`, before PR 45 merges)

- **Test first (measured):** the five test files were committed alone in `a05cf94` (types only, no implementation); `vitest run apps/demo` failed 5 of 5 files with missing modules. After the implementation: 41 of 41 pass.
- **Commands (measured):** `pnpm demo` writes 18 files to `demo/out/`: `beat-<n>.md` and `beat-<n>.json` for beats 1, 2, 3, 4, 5, 6, 7 and 10, plus `closing.md` and `index.html`, and prints the narration. `pnpm demo --beat 4` writes only `beat-4.*`, `closing.md` and `index.html`. `pnpm demo --beat 9` exits 2 naming the available beats and writes nothing. `pnpm demo --live` exits 2 with "Live mode calls judges from two model families and needs an API key for each…" and writes nothing.
- **No environment read (measured):** a test scans every non-test source file under `apps/demo/src` for `process.env`, `.env` and `dotenv`; none matches. The `--live` refusal is decided from the flag alone.
- **Viewer is static (measured):** tests assert no `<script`, `<link`, `<img`, `<iframe`, `url(` or `http(s)://` in `index.html`, that every `<details>` is closed by default, and that a hostile title or summary is escaped. Opened in the browser pane: at 408 px wide the page has no horizontal scroll after a grid fix (`scrollWidth` 393 against `innerWidth` 408); at 1,280 px beat 3 shows the timeline beside the balances and the panel table with three pinned model IDs.
- **Narration rules (measured by test):** every narrated line has a number after its `+N ms` stamp; no line uses a cast key instead of a name; no line or header contains any of 14 marketing words; every transcript header says "recorded verdicts" and names its source.
- **Money (measured by test):** amounts print from base-unit strings with bigint only (`2,050 tUSD`, `1,400.50 tUSD`); fractions, signs, exponents and unknown tokens are refused. Every beat's balance snapshots sum to the same total.
- **JSON (measured by test):** `beat-<n>.json` parses back to exactly the transcript object.
- **Time to first transcript on a fresh tree (measured):** `git archive HEAD` extracted into an empty directory (the agent sandbox refuses `git clone` outside the worktree, so this stands in for a clone): `pnpm install --frozen-lockfile` 0.95 s with a warm pnpm store, `pnpm demo` 1.26 s including the `tsc -b apps/demo` build, first transcript 1 ms after the CLI started, all 8 in 8 ms. A cold store will be slower (inferred); the 5-minute criterion is far off either way for the stand-in (inferred). Re-measure once T-012's runner is wired, since it builds every package and starts two operators per beat (inferred: about 3 s of beats from T-012's 2.8 s test run).
- **The numbers in the transcripts are illustrative (measured: every transcript says so).** Hashes are derived from labels; timings are written by hand; model IDs are placeholders; the signed message is not signed. Balances follow T-012's measured beat table (Atlas 7,950 / 9,950 / 8,600 tUSD; Tidewater 2,000 / 0 / 1,400) and the SimChain postings table (inferred correct for the stand-in's flows).
- **`pnpm verify` (measured, commit `518193f`, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 191 ms |
  | lint | `pnpm lint` | pass | 2003 ms |
  | test | `pnpm test` | pass | 17259 ms |
  | spec | `pnpm validate:spec` | pass | 278 ms |
  | snap | `pnpm snap` | pass | 624 ms |
  | demo | `pnpm demo` | pass | 199 ms |

  58 test files, 1,804 tests, all passing. `demo` is no longer a placeholder.

### Dry run (human gate, open)

Not done; Rafa runs it. Prepared:

1. On a fresh clone: `pnpm install && time pnpm demo`, then `open demo/out/index.html`. Record the time to the first transcript (the CLI prints it) and the wall time.
2. Hand a reviewer who has not read the docs only `demo/out/` and ask the four questions. Expected answers, quoted from the stand-in transcripts:

   | Question | Expected answer | Where |
   | --- | --- | --- |
   | Who held the money? | The escrow on SimChain: "Ledger (Atlas Research) signs and holds 2,050 tUSD in escrow in one call, relayed by op-1. Neither party can move it alone." Balances show Escrow 2,050 tUSD. | `beat-1.md`, Timeline and Balances |
   | Who decided? | Clearfield Adjudication (Bench A), which both agents named in the offer, on a panel of three pinned judges from two families: "Clearfield Adjudication (Bench A) signs the primary decision: accept". In beat 7, Northgate Review as fallback. | `beat-3.md`, `beat-1.md` (offer), `beat-7.md` |
   | What stopped the injection? | The screen flagged a base64 instruction, so the panel could not auto-accept; Clearfield escalated to Atrium Appeals, whose five judges from three families all failed it, and Ledger was refunded. Hidden tag characters in the second delivery were stripped by Ledger's SDK before Ledger read the file. | `beat-6.md` |
   | What happened when op-1 refused? | "Ledger's SDK got 1 refusal (HTTP 503) and failed over to op-2 within 9 ms; Tide-7 later submits its signed delivery directly to SimChain, so no operator is required." The commitment settled. | `beat-7.md`, Neutrality events |

3. Record whether each answer came from the transcript alone, and anything the reviewer misread, here.

## Decisions

- **A typed transcript interface between runner and renderers** (`apps/demo/src/transcript/types.ts`): `BeatTranscript` with a closed union of 16 event kinds, and `EventSource { beats(), run(beat) }`. Narration, Markdown, JSON and HTML read only this, so the runner can change without touching them, and T-012's runner plugs in as a second source.
- **Stand-in source, labeled.** `apps/demo/src/source/stand-in.ts` scripts beats 1 to 7 and 10 with illustrative numbers so `pnpm demo` works and the viewer can be reviewed now. Each transcript's header and the viewer badge say "stand-in". Its balances follow T-012's measured beat table.
- **Beats 1 to 4 are four transcripts of one job,** each with times since its own start, so `--beat 4` shows settlement alone. Beat 6 holds both deliveries (base64 injection, then hidden tags) in one transcript. Beats 8 and 9 are not offered (optional; no runner).
- **File names `beat-<n>.md` / `.json`,** plus `closing.md` for the closing section; `index.html` covers the beats run in that invocation.
- **`--live` exits 2** with a message, before any source runs; it never looks for keys.
- **No JavaScript in the viewer.** `<details>` collapses the signed message natively; light and dark themes by CSS only.
- **Placeholder model IDs** (`claude-opus-5-5-20260601`, `claude-haiku-5-20260601`, `gemini-4-pro-001`, `gemini-4-flash-001`, `mistral-large-2611`) in the stand-in panels; the real pinned IDs come from the Bench registrations (T-012 backlog). Before showing the demo to an AI lab, these must be real registry IDs.
- **Outside `apps/demo/`:** the root `package.json` `demo` script now runs `tsc -b apps/demo && node apps/demo/dist/bin.js` instead of the placeholder, since `pnpm demo` is the acceptance criterion; and this task file. `apps/demo/tsconfig.json` gains `types: ["node"]`.
- **Cast names** live in `apps/demo/src/transcript/cast.ts` until T-012's `apps/demo/agents/cast.ts` exists (it is not on PR 45 yet).

## Handoff

**Wired:** `pnpm demo`, `--beat n`, `--live` (refuses), `--out dir`; narration; `beat-<n>.md`, `beat-<n>.json`, `closing.md`, `index.html`; the closing section (finality, residuals 1 to 12, three asks for AI labs); the stand-in source.

**Stubbed, waiting on T-012 (PR 45):** the SimChain beat runner. When PR 45 merges:

1. Merge `origin/main`; add a `simchain` `EventSource` in `apps/demo/src/source/` that calls `createDemoWorld({ seed })` and `beatHold`, `beatHappyPath` (sliced into beats 1 to 4), `beatBadWork`, `beatHiddenTags` and `beatMutualSplit`, maps `JobResult` (commitment, delivery facts, checks, panel, opened, payouts, vias) and `world.balance()` reads into events, and closes the world. Timings: measured wall milliseconds, or a fixed clock if the transcripts are to double as `.expect.md` snapshots (T-010).
2. Compose sources per beat: SimChain where T-012 has a runner, the stand-in for beat 6's injection half and beat 7 until those runners exist. The per-transcript `source` already says which is which.
3. Import cast names from `apps/demo/agents/cast.ts` if it lands; add the workspace dependencies and a tsconfig reference to `apps/demo/agents`.
4. Re-measure time to first transcript and re-run `pnpm verify`.

**Not done:** the dry run with Rafa (human gate, prepared above); real pinned model IDs (needs Bench registrations); beats 8 and 9; transcripts as scenario snapshots (T-010).
