# T-027: The site at npc.here.now/escrow: tagline and agent docs (moved to escrow.stream, 2026-11-01)

- **Lane:** demo + docs
- **Phase:** 1 (public demo)
- **Depends on:** T-025 (docs content); T-026 (live URLs, filled in at the end)
- **Paths this task may touch:** `site/` (new: `index.html`, `llms.txt`, `agents.md` or equivalent), `docs/tasks/T-027-agent-docs-site.md`
- **Human gate:** publishing is done by the coordinator (Rafa approved the location on 2026-11-01)
- **Status:** done (PR 60; published 2026-11-01 at npc.here.now/escrow, moved to https://escrow.stream the same day; the old address redirects)
- **Agent/session:** implementer, branch `t-027-agent-docs-site`

## Intent

Rafa, 2026-11-01: "keep it super super simple (apple light simple), only a tagline and agent docs needed for someone to execute the protocol." The page is for a person deciding to try it and, mostly, for the agent they point at it. An agent reading only this site (no repo) can run one honest checks-only deal: get keys, get test tUSD, offer, agree and fund, deliver, settle.

Restate this in your own words in this section before writing code.

**Restated (implementer).** Two static files at `/escrow/`: a quiet page that says what Holdback is in a tagline and a sentence, says plainly that only test tokens are involved, and tells a person where to point their agent; and the agent docs, which are the real product of this task. The docs must be enough on their own: an agent that never sees the repo makes its own keys, gets test tUSD, offers or agrees, funds, encrypts and delivers, and reads and opens the result, verifying each prepared message against its own intent with the domain and types printed on the page. The content is honest about what is simulated (one shared settlement layer, one basic adjudicator, scripted panel, resettable state) and stays on the checks-only happy path.

Non-goals: publishing or hosting (coordinator); filling the live operator URLs (placeholders `{{OP1}}`/`{{OP2}}` until T-026 deploys); appeals, timeouts, early accept, settlements and other edge paths; a rubric or panel walkthrough; brand work beyond the tagline; any change outside `site/` and this task file.

## Design

- Static files only (here.now hosting). One `index.html`: a one-line tagline, one sentence on what it is, a "Point your agent here" line with the `llms.txt` URL, the test-token notice, and the agent docs below or behind one link. Light, generous white space, one typeface, no illustrations, no marketing sections. Works at phone width. Mirror the docs as `llms.txt` (plain text, the canonical agent entry).
- Every relative URL must work under the path prefix `/escrow/`.
- API base URLs are placeholders `{{OP1}}` and `{{OP2}}` that the coordinator fills after T-026 deploys; keep them in one place.

## Agent docs content (from `docs/api.md` and `docs/quickstart.md`, rewritten for an outsider with no repo)

- What it does in three lines: buyer funds a hold, seller delivers encrypted work, checks decide, money and the key move together.
- Keys: generate a secp256k1 signing key and an x25519 encryption key with any standard library (name viem/ethers/eth-account and tweetnacl/libsodium/PyNaCl).
- The happy path as numbered calls with request and response shapes: discovery, faucet, recipients, `prepare/offer` → sign → submit, `prepare/agree-and-fund` → verify → sign → submit, ciphertext upload, envelope spec (AES-256-GCM + x25519-xsalsa20poly1305 box, with the test vector), `prepare/delivery` → sign → submit, poll state, read the key, open and check hashes.
- Verify before you sign: the short checklist (pin the domain, your own nonces, expected price, terms key is yours, time from two operators). The EIP-712 domain and types inline so no repo is needed.
- Writing checks that protect a buyer (the T-025 worked example, checks-only template).
- Honest limits: test tUSD only, a simulated settlement layer shared by both nodes, one basic adjudicator with real deterministic checks and a scripted panel, state may reset, edge cases not covered. Link the public repo for the curious, not as a requirement.

## Acceptance criteria

- [x] `site/index.html` and `site/llms.txt` exist, match the design, and contain everything above; no repo link is required to complete the happy path.
- [x] A check (test or script) confirms every `{{OP1}}`/`{{OP2}}` placeholder is in a known place and every relative link resolves under `/escrow/`.
- [x] Content agrees with `docs/api.md` (field names, routes, envelope spec, test vector).
- [x] PR opened.

## Out of scope

- Hosting and publishing (coordinator); brand work beyond the tagline; anything beyond the happy path.

## Evidence

- **Measured:** `node site/walkthrough.mjs` follows llms.txt with no Holdback code (fetch, viem, tweetnacl, types parsed from llms.txt itself) against an in-process sim and prints `walkthrough PASS`. Each step is checked: the pinned domain matches; registrations and rulebook agree on both operators and hash as documented; the offer's `CommitmentTerms`, built from intent with the documented defaults, matches the operator's message and digest; `id` is its struct hash; /terms recomputes to the same ID; `Agree` and `FundingAuthorization` built from the terms match and the hold is `Held 26000000`; /recipients matches the documented order; four 139-character envelopes; `Delivery` with `unlock {kind:"", round:0}` matches; then `Released`, `finalAt` null until `appealBy`, judgment `accept` with `panel.ran false`, and the buyer opens and hash-checks the work.
- **Measured:** `node site/check.mjs` prints `site check PASS`. It covers: index.html is fresh; each placeholder appears once in its known place; filled builds leave no placeholder or note; a build with a CONFIRM note left is refused; every link resolves under /escrow/; the types and domain equal `examples/verify.ts`; the test vectors and worked checks equal `docs/api.md`; every route (except `/v1/faucet`) is in `docs/api.md`.
- **Measured:** `pnpm verify` PASS (typecheck, lint, test, spec, snap, demo): `reports/verify-t-027-agent-docs-site.md`.
- **Measured:** the page was viewed in the browser pane at desktop width and at 375 px. At 375 px, scrollWidth equals clientWidth (375), so there is no horizontal page scroll. Code blocks and tables scroll inside their own boxes.
- **Inferred:** check.mjs fails on a stale page or a moved placeholder (from the code paths; no mutation run was recorded).
- **Measured (live, 2026-11-01, after T-026 merged at a2a3c2e):** `OP1=https://holdback-op1.<account>.workers.dev OP2=https://holdback-op2.<account>.workers.dev node site/walkthrough.mjs` printed `walkthrough PASS (live …)`. It used two fresh self-made addresses, each funded once by `POST /v1/faucet`, so 2 grants. The run reached club `demo-club` and a 1,000 tUSD balance. Adjudicators came by role from `GET /`. The offer used the docs' 60-second windows, and every message the walkthrough built matched the operator's typed data and digest. The deal went `Held 26000000`, then `Released`, then final at `finalAt` 2026-11-01T12:16:13Z (equal to `appealBy`, one minute after the decision) with nobody acting. Commitment `0x176c0de2…`.
- **Measured:** the faucet response shape (`address`, `clubId`, `granted`, `balance`, `mandate` with `mandateHash`, `nextGrantAfter`, `notice`) was read from `apps/demo-cloud/src/world.ts`. The three adjudicator roles were read from live `GET /`. The demo club's 60-second minimum was read from `docs/api.md` "Public demo" and from the live `minWindowSec`.
- **Measured:** `reports/site-out/` holds the publish build (live origins filled; no placeholder or editor note), and `node site/check.mjs` passes against it. `reports/` is git-ignored, so the build is not in the PR.

## Decisions

- **One source.** `site/llms.txt` is the canonical text; `site/build.mjs` renders `site/index.html` from it (a small Markdown subset: headings, paragraphs, lists, tables, fenced code). The page's top (tagline, sentence, test-token notice) is taken from the head of llms.txt, so the two cannot drift; `site/check.mjs` fails if `index.html` is stale. Alternative rejected: hand-written HTML duplicating the docs.
- **Placeholders in one place.** `{{OP1}}` and `{{OP2}}` appear once each, as `OP1=` / `OP2=` under "Configure"; every command uses `$OP1`/`$OP2`. The repo link was first a `{{REPO}}` placeholder, because the repo was private. Once it went public, the coordinator asked for https://github.com/rafaeldavid/holdback as a fixed link, labeled optional reading. The placeholder and `--repo` were removed; `build.mjs` ignores the flag if it is passed.
- **Faucet and adjudicators confirmed after T-026.** The docs were first written to T-026's plan with `%% CONFIRM` notes. `build.mjs --out` refuses to build while a note remains, and `%%` lines never reach a published file. Both notes are now resolved and deleted. The faucet section shows the real response. The demo has three adjudicators by role, from `GET /`, not one in three roles.
- **Example timing is the demo's fastest valid.** The offer example sets `judgeWithinSec`, `fallbackWithinSec`, `appealWindowSec` and `appealDecideSec` to 60, the demo club's minimum, so a deal is final about a minute after the decision. The verification list describes `judgeBy` and `fallbackBy` in terms of the windows sent, and states the defaults for windows left out. The local walkthrough uses 300, because the `pnpm sim` club requires 300 for the appeal windows.
- **Links are `/escrow/…`, not page-relative.** A page-relative `llms.txt` breaks if the host serves `/escrow` without a trailing slash; root-relative paths with the prefix work either way. `check.mjs` refuses page-relative links.
- **Typefaces.** The system UI face for text, and the system monospace face only inside code, because hashes, JSON and curl lines need fixed width. No web fonts, no images, no scripts, light only.
- **Verification without the repo.** `verify.ts` is TypeScript in the repo, so the page states the checks as a six-point list plus the exact field values for each message (including the default timing arithmetic and `unlock: {kind: "", round: 0}` in Delivery), and prints the schema 0.6 types. `site/walkthrough.mjs` proves the list is sufficient and correct: it builds every message from the page alone and compares with the operator.

## Handoff

Done after T-026 landed: the CONFIRM notes are resolved and deleted, the live walkthrough passed, and the publish build is in `reports/site-out/`.

For the coordinator:

1. Publish `reports/site-out/index.html` and `reports/site-out/llms.txt` to npc.here.now/escrow/. To rebuild, run `node site/build.mjs --op1 https://holdback-op1.<account>.workers.dev --op2 https://holdback-op2.<account>.workers.dev --out reports/site-out`, then `node site/check.mjs`. Do not publish `site/` directly: its `llms.txt` holds the `{{OP1}}`/`{{OP2}}` placeholders.
2. Re-measure after any change to the live API: `OP1=… OP2=… node site/walkthrough.mjs`. It uses 2 faucet grants and takes about a minute and a half, because it waits for `finalAt`.

Cross-lane follow-up (outside this task's paths): `site/check.mjs` is not yet run by CI. Add a root script (for example `"site:check": "node site/check.mjs"`) and a `scripts/verify.ts` step, or move it to `tests/site.test.ts`. `site/walkthrough.mjs` needs a built `apps/operator` (`pnpm build`) in its local mode.
