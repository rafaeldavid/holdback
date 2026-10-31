# T-013: Narrated CLI, transcript renderer, static viewer, dry run

- **Lane:** demo
- **Phase:** 1
- **Depends on:** all Phase 1 tasks
- **Paths this task may touch:** `apps/demo/`
- **Human gate:** yes (dry run with Rafa)
- **Status:** in progress (merged in PR 46; dry run with Rafa open; beats 6a and 7 on SimChain since T-018)
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

- [x] `pnpm demo`, `--live`, `--beat n`; writes `demo/out/<beat>.md`, `.json`, `index.html` (static, no network). (`--live` refuses until keys exist. Beats 1 to 5, 10 and the hidden-tags half of 6 run on SimChain; beat 7 and the injection half of 6 are a labeled stand-in.)
- [x] Narration follows the rules in `docs/demo.md`; recorded mode says so.
- [x] Viewer shows timeline, balances, panel (model IDs), signed message (collapsed), neutrality events. (Model IDs are config/judges.yaml's pinned placeholders.)
- [x] Closing section states residual risks and asks for AI labs.
- [ ] Dry run on a fresh clone: time-to-first-transcript measured; four comprehension questions answered by a reviewer from transcripts alone.

## Out of scope

- Hosted deployment.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

### PR 46 review fixes (2026-10-31)

- **Untrusted output surfaces (measured):** `untrusted.test.ts` was committed in `a59f084` before the renderers used the helpers, and 5 tests failed. The hostile check detail combines a Markdown image, a link, `<img>`, an OSC 8 terminal hyperlink, a screen-clear escape, a bidi override, tag characters, a newline heading, a CRLF table row, a fence and `www.`. After `2a941ff` it passes on four surfaces:
  - terminal: no control, bidi or tag character and no line break in any line that carries the payload;
  - Markdown: no unescaped image, link, `<`, heading or table row outside the signed-message fence, and that fence is longer than the payload's backtick run;
  - HTML: `&lt;img`, no invisible characters;
  - JSON: invisibles written as `\u` escapes.
- **Confirmed upstream (measured):** `packages/judgment/src/checks/index.ts:164` writes the CSV header names into `csv_columns_exact`'s detail. It is recorded in `docs/backlog.md` (Judgment defenses); `packages/judgment` is unchanged.
- **Stand-in marks (measured):** a test marks every event stand-in and checks each timeline line, panel heading, balances label and signed-message heading in Markdown, and each panel `<h3>`, balances header, signed `<summary>` and timeline item in HTML.
- **No-env test (measured):** now scans `apps/demo/agents` too (more than 15 files), and checks that `world.ts` starts operators with `env: {}`.
- **`pnpm verify` (measured, commit `2a941ff`, clean tree):** PASS. 62 test files, 1,845 tests; demo 2,455 ms.

### SimChain runner wired (2026-10-31, after PR 45 merged as `779b13e`)

- **Test first (measured):** `source/simchain.test.ts` and the narrowed `stand-in.test.ts` were committed in `a37e8bb` before `source/simchain.ts` and `source/demo.ts` existed; the SimChain file failed to import and 4 CLI tests failed. After `978c1f3`: 53 of 53 demo tests pass.
- **Beats on SimChain (measured, seed 7, `simchain.test.ts`):** beat 1 holds 2,050 tUSD through op-1 (Ledger 7,950, Escrow 2,050, Clearfield 2,000 reserved), with Tide-7's signed offer (a 65-byte EIP-712 signature). Beats 2 to 4 share one commitment. In beat 3, 9 of 9 checks pass and a commit-reveal panel of 3 judges (`placeholder-qwen-a-20260601`, `placeholder-claude-a-20260601`, `placeholder-claude-b-20260601`, 2 families) accepts. In beat 4, 2,000 tUSD goes to Tide-7 and 50 to Clearfield, the key goes to Ledger, and the 511,912 plaintext bytes match `sha256:1939b96f…`. In beat 5 only `rows` fails (8,740 rows), Ledger ends at 9,950 tUSD and no key is released. In beat 6's hidden-tags half the screen flags `unicode_tags`, and Ledger's SDK strips 111 tag characters. In beat 10 the 70/30 split leaves Ledger at 8,600, Tide-7 at 1,400, and Clearfield's reservation at 0. Every SimChain transcript's balance snapshots sum to the same total, and every time is a non-negative integer in order.
- **Times are measured (measured):** each settlement event carries the wall-clock milliseconds since the job's first call, recorded by wrapping the world's `SimChain.submit` and `trigger`. One run gave offer +15 ms, hold +24 ms, delivery +39 ms, and decision and release +324 ms; Ledger opened the work at +586 ms. Times vary per run, so these transcripts cannot be byte-stable snapshots (inferred).
- **Model IDs (measured):** every panel model in both sources is an active entry in `config/judges.yaml`, read through `demoRegistry()`; a test checks this.
- **Cast (measured):** the names come from `apps/demo/agents/cast.ts` through the package's `./agents/*.js` export; only the operators, SimChain, Escrow and Ledgerwatch Audit are local.
- **Fresh tree (measured):** `git archive HEAD` extracted into an empty directory, warm pnpm store: install 0.84 s; `pnpm demo` 7.5 s wall, including `tsc -b` of every referenced package from scratch; first transcript 118 ms after the CLI started, all 8 in 1,785 ms; 18 files written.
- **Viewer (measured):** in the browser pane at 408 px the page does not scroll sideways (`scrollWidth` 393); beat 6 shows 10 events badged "stand-in"; no `<details>` is open.
- **`pnpm verify` (measured, commit `978c1f3`, clean tree):** PASS. typecheck 185 ms, lint 1,909 ms, test 16,506 ms (61 files, 1,837 tests), spec 264 ms, snap 632 ms, demo 2,377 ms.

### Stand-in source (2026-10-31, branch `t-013-demo-cli`, before PR 45 merged; superseded where noted above)

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
2. Hand a reviewer who has not read the docs only `demo/out/` and ask the four questions. Expected answers, quoted from the transcripts (SimChain unless marked stand-in):

   | Question | Expected answer | Where |
   | --- | --- | --- |
   | Who held the money? | The escrow on SimChain: "Ledger (Atlas Research) signs and holds 2,050 tUSD in escrow in one call, relayed by op-1. Neither party can move it alone." The balances show Escrow 2,050 tUSD. | `beat-1.md`, Timeline and Balances |
   | Who decided? | Clearfield Adjudication (Bench A), which both agents named in the offer, on a panel of three pinned judges from two families: "Clearfield Adjudication (Bench A) signs the primary decision: accept, submitted directly to SimChain (no operator)." In beat 7, Northgate Review decides as fallback; in beat 6, Atrium Appeals decides the escalated case. | `beat-3.md`, `beat-1.md` (offer), `beat-7.md` |
   | What stopped the injection? | Measured on SimChain since T-018. The base64 delivery: "The screen at Clearfield Adjudication (Bench A) flags 2 signals (encoded\_run, instruction\_phrase): decodable base64 run of 156 characters at line 4752 …"; Clearfield's three judges all passed it, yet "panel outcome: escalate"; "Clearfield Adjudication (Bench A) escalates to Atrium Appeals (Bench C) … the appeal panel seats 5 judges from 3 families"; Atrium's five judges (scripted verdicts) fail it and "Atrium Appeals (Bench C) signs the appeal decision: reject"; "Escrow refunds: 2,000 tUSD to Ledger". The hidden-tags delivery: the tag characters are in the signed judgment record, and Ledger's SDK stripped all 111 before Ledger read the file. | `beat-6.md` |
   | What happened when op-1 refused? | Measured on SimChain since T-018: "op-1's own relay policy answered HTTP 403 … to 4 write calls during the job: the offer, the agree-and-fund call, the delivery, the fallback trigger"; the hold is "relayed by op-2"; op-2 then goes offline and the delivery is "submitted directly to SimChain (no operator)"; Clearfield stays silent, Ledger triggers the fallback, and Northgate Review releases 2,000 tUSD to Tide-7 with the key to Ledger. | `beat-7.md`, Neutrality events |

   No transcript carries stand-in events since T-018. Beat 6's appeal verdicts are scripted, and the source note says so. If the reviewer reads "scripted verdicts" as "not real", record that here.

3. Record whether each answer came from the transcript alone, and anything the reviewer misread, here.

## Decisions

- **A typed transcript interface between runner and renderers** (`apps/demo/src/transcript/types.ts`): `BeatTranscript` with a closed union of 16 event kinds, and `EventSource { beats(), run(beat) }`. Narration, Markdown, JSON and HTML read only this, so the runner can change without touching them, and T-012's runner plugs in as a second source.
- **Three sources.** `simchainSource` (T-012's beats, measured), `standInSource` (beat 7 and beat 6's injection half only, illustrative), and `demoSource`, which `pnpm demo` uses and which composes the two. A transcript's `source.kind` is `simchain`, `stand-in` or `mixed`. In a mixed transcript, each stand-in event carries `standIn: true`, which narration prints as `[stand-in]` and the viewer as a badge.
- **Beat 1 runs `beatHold` alone,** so `--beat 1` does not deliver. Beats 2 to 4 share one `beatHappyPath` run per source instance, sliced by phase. Times count from the job's first call, so beat 4's times continue beat 3's.
- **Measured times by wrapping `SimChain.submit` and `trigger`** on the demo world's chain instance. The beat functions return only final results, and the sim clock moves in whole seconds. The wrapper passes each call through unchanged and records the time and ledger after it. Times therefore vary per run.
- **Balances from the ledger:** each party's account; Escrow as the sum of `escrow:*`; each bench as its free balance plus its junior and senior bond, with its reserved bond. All three benches always appear, so the snapshots sum to the minted total.
- **Mutual settlement shows the fee returned to Ledger** as a payout row. The `commitment.settled` payload lists only the price split; the fee row follows the ADR-0019 Phase 1 rule, and the balance snapshot (8,600 tUSD) confirms it.
- **Beat 6 is one transcript:** the stand-in injection half first, without its balance snapshots, then the measured hidden-tags half with its times shifted to start after it. Beats 8 and 9 are not offered (optional; no runner).
- **Panel rule** comes from the record's first aggregate reason, not from a threshold field, since the policy is not in `JobResult`. Scores are hundredths of a rubric point ("4.00 of 4"), computed from the verdict criteria and the terms' weights.
- **File names `beat-<n>.md` / `.json`,** plus `closing.md` for the closing section; `index.html` covers the beats run in that invocation.
- **`--live` exits 2** with a message, before any source runs; it never looks for keys.
- **No JavaScript in the viewer.** `<details>` collapses the signed message natively; light and dark themes by CSS only.
- **Model IDs from `config/judges.yaml`.** The stand-in panels name registry judges by ID (`claude-a`, `gpt-a` and so on) and take their pinned placeholder models through `demoRegistry()`, so no model ID is invented. The registry's IDs are themselves placeholders until promotion (`docs/decisions/registry-log.md`).
- **Cast from `apps/demo/agents/cast.ts`,** imported through a self-reference export, `"./agents/*.js"`, in `apps/demo/package.json`. `dist/` and `agents/` are siblings, so a relative import would not resolve at run time. Ledgerwatch Audit is not in that file and stays local, for the viewer's introduction only.
- **Outside `apps/demo/`:** the root `package.json` `demo` script (`tsc -b apps/demo && node apps/demo/dist/bin.js`) and this task file. Nothing in `apps/demo/agents/` changed.

## Handoff

**Wired:**
- Commands: `pnpm demo`, `--beat n`, `--live` (refuses), `--out dir`.
- Output: narration, `beat-<n>.md`, `beat-<n>.json`, `closing.md`, `index.html`, and the closing section.
- SimChain: beats 1, 2 to 4, 5, 10, and the hidden-tags half of 6 run through T-012's beat functions.
- Cast: names come from `agents/cast.ts`.

**Stand-in, labeled (waits on T-012's backlog):**
- Beat 6's injection half (base64 instruction, escalation, five-judge appeal panel) needs an injection deliverable and an escalation beat in `apps/demo/agents/`.
- Beat 7 (op-1 refusal, Bench A offline with fallback takeover, club revocation) needs a neutrality beat.
- When either lands, add it to `simchainSource` and drop the matching script from `stand-in.ts`; `demoSource` then picks the SimChain run.

**Not done:**
- The dry run with Rafa (human gate, prepared above).
- Beats 8 and 9.
- Transcripts as scenario snapshots (T-010). Measured times differ per run, so snapshots would need a fixed clock or the times masked.
