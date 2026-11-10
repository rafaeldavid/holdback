# T-312: the landing page from Rafa's mock, the move to crow.direct, and forwarding from escrow.stream

- **Lane:** infra
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** deploys and config plus docs (Change recipes: 8, with 1 for the site and 2 for the docs)
- **Depends on:** nothing. Rafa asked for it on 2026-11-10 and bought crow.direct the same day.
- **Paths this task may touch:**
  - PR A (the landing page): `site/build.mjs`, `site/check.mjs`, `site/llms.txt`, `site/index.html`, `README.md`, `tools/design-map/template.html`, `brand/README.md`, `brand/messaging.md`, `docs/decisions-today.md` (D56), this file;
  - PR B (the domain): `apps/site/`, `apps/early-access/`, `apps/test-agents/`, `apps/demo-cloud/` (wrangler files, the deploy script, tests), `apps/operator/src/` (the agent guide and problem-type URLs, tests), `site/` (build, check, llms.txt, index.html, try.mjs, visualdemo), `examples/try.ts` and `examples/try.test.ts` (the try command's default operators), `spec/openapi.json` and `spec/openapi/paths.json` (descriptions only, not `spec/schemas/`), `packages/core/src/trim.test.ts`, `tests/` (a new forwarding test, and the contract test's agent-guide URL), `tools/contract-stack/template.html`, `brand/sketch/card.mjs` (a comment), `README.md`, `SECURITY.md`, `docs/api.md`, `docs/quickstart.md`, `docs/operations.md`, `brand/README.md`, `brand/messaging.md`, this file.
- **Human gate:** yes for every deploy, and for the Cloudflare account and the Crow Control Access application. Nothing here deploys.
- **Status:** review
- **Agent/session:** T-312 implementer session, 2026-11-10, worktree `.worktrees/t-312`, branches `t-312-tagline` (PR A) and `t-312-crow-direct` (PR B, stacked on A)

## Intent

Rafa gave the product a new page and a new address on 2026-11-10.

1. **The landing page (PR A).** The site follows Rafa's mock (`crow-landing-mock-v2.html`), in its wording exactly: the bird, the ’crow mark, the tagline "Verifiable settlement for AI commerce", a headline that alternates "Sell to" and "Buy from" before "any agent.", the lede, early access, six features and the footer. It works like the live site: the sign-up reaches the early-access Worker, the bird is the site's own `/crow.png`, every call in the code columns exists in `examples/agent.ts`, and agents still find `/llms.txt` and the One-Click Try prompt. `site/llms.txt` opens with the same tagline, headline and lede. D56 records it and supersedes D40's tagline; D40's privacy part stands. Rafa's first wording the same day ("Verified Settlement for AI Commerce", "Safe to buy. Safe to sell.") is superseded and does not ship.
2. **The domain (PR B).** crow.direct becomes the canonical home, with the same map of hostnames as escrow.stream today: crow.direct and www.crow.direct for the site, api.crow.direct and api2.crow.direct for the two operators, join.crow.direct for sign-ups, crow.direct/agents/test-seller for the test seller (agents.crow.direct as the fallback, as D47 has it).
3. **Forwarding (PR B).** People and agents who reach escrow.stream land on crow.direct:
   - the site Worker answers escrow.stream and www.escrow.stream with a 301 to the same path and query on https://crow.direct;
   - the test-agents Worker answers escrow.stream/agents/test-seller* with a 308, which keeps a POST's method and body;
   - the early-access Worker answers join.escrow.stream with a 301 for GET and a 308 for POST to join.crow.direct;
   - the operators serve both hostnames and redirect nothing: agents POST signed messages, many clients do not follow a redirect for a POST, and the EIP-712 domain (Holdback) names no host, so a signature is valid on both.
4. **Canonical URLs (PR B).** Every doc, agent card and published URL names crow.direct: llms.txt and its try command (with a new SHA-256 pin), the test seller's card, the operators' agent-guide and problem-type links, the OpenAPI descriptions, `docs/api.md`, `docs/quickstart.md`, `docs/operations.md` and the README.

**Non-goals.**
- No deploy, no DNS change and no dashboard rule. Forwarding is code in the Workers. Every deploy waits for Rafa, and the PR body carries the plan.
- control.crow.direct. Crow Control lives in the private repository; the Handoff notes it.
- `CLAUDE.md`. It is tier 3, and Rafa merges it; PR A's body lists its stale line.
- History. `docs/log/`, `docs/reviews/`, `docs/research/`, past decisions and done tasks' Evidence keep escrow.stream.
- Dropping escrow.stream. The old hostnames stay attached while the forwarding runs.
- The rest of `site/llms.txt`. Only its tagline and first paragraph change in PR A.

## Context

- Rafa, 2026-11-10, first: "Let's do: Verified Settlement for AI Commerce. Safe to buy. Safe to sell. …" Then: "ok change of direction, use the attached file for the update", with `crow-landing-mock-v2.html` (untracked in the main checkout).
- Rafa, 2026-11-10: "And change the domain to the one I just bought "crow.direct"", and "Forward escrow.stream to crow.direct so people automatically reach the new site."
- D40 (the old tagline), D47 (the test seller's route), D51 (One-Click Escrow: the homepage's copied prompt), `docs/operations.md` (what is live and how it deploys), `docs/team.md` (Change recipes).
- crow.direct and escrow.stream both use the Cloudflare nameservers lisa and tate, so they are very likely in one account [measured by the coordinator; the account itself is guessed].

## Acceptance criteria

PR A:
- [x] `site/index.html` follows the mock: layout, EB Garamond, colours, code columns, bird, mark, tagline, rotating headline with its screen-reader text and reduced-motion handling, lede, sign-up, six features, footer, all in the mock's words.
- [x] The sign-up posts to the early-access Worker with the live page's request, page field, messages and honeypot; the bird is `/crow.png`; every link is relative.
- [x] Every call in the code columns exists in `examples/agent.ts`, with real template names, states and fields.
- [x] The page keeps the One-Click Try prompt (D51) and links `/llms.txt` in one quiet footer line.
- [x] `site/llms.txt` line 3 reads "> ’crow. Verifiable settlement for AI commerce", and line 5 is the mock's headline and lede.
- [x] The description, og and twitter tags carry the mock's description and "’crow · Verifiable settlement for AI commerce".
- [x] The README's first line, the design map and the brand status lines name the new tagline; D56 is in `docs/decisions-today.md`, and D40 points at it.
- [x] `node site/build.mjs && node site/check.mjs` passes, and screenshots at 1440, 768 and 390 px match the mock.

PR B:
- [x] The site Worker returns a 301 to https://crow.direct with the path and query kept for an escrow.stream or www.escrow.stream Host, and serves the static assets for crow.direct.
- [x] The test-agents Worker returns a 308 for a POST on escrow.stream, and the early-access Worker a 308 for a POST and a 301 for a GET on join.escrow.stream.
- [x] The operators answer on both hostnames and advertise crow.direct.
- [x] The early-access Worker's CORS list allows both origins.
- [x] Every current doc, card and published URL names crow.direct; history is unchanged.
- [x] The PR body lists the deploy commands in order, each with its rollback, and the post-deploy checks.

## Plan

1. PR A, branch `t-312-tagline`: the landing page in `site/build.mjs` (the one renderer), its structure check in `site/check.mjs`, `site/llms.txt` lines 3 and 5, a rebuild of `site/index.html`, the README, the design map, the brand status lines and D56.
2. PR B, branch `t-312-crow-direct` on A: tests first (`tests/forwarding.test.ts` for the site and early-access Workers, the test seller's Worker test, the operator tests), then the Workers and their wrangler files, then `SITE_URL` in `site/build.mjs` and every canonical URL, then a rebuild so the try command's SHA-256 matches.
3. Deploy order, for Rafa: the operators (additive) → test-agents → early-access → site. The site goes last, because it starts the forwarding.

## Evidence

PR A:
- `node site/build.mjs && node site/check.mjs`: "site check PASS"; `site/try.mjs` is unchanged at SHA-256 `cc310963…d832` (measured, 2026-11-10).
- The page's one inline script parses (`new Function`), the page has 6 feature cells, the bird is `/crow.png` and the footer links `/llms.txt` (measured with node on the built `site/index.html`).
- Screenshots of the built page served locally and of the mock, both in headless Chrome, 2026-11-10 (measured; looked at side by side):
  - 1440 px: `reports/scratch/landing-1440.png` and `reports/scratch/landing-mock-1440.png`. Same layout, type and colours; both code columns show; the page has one more footer line, so the feature grid sits about 24 px higher.
  - 768 px: `reports/scratch/landing-768.png` and `reports/scratch/landing-mock-768.png`. The code columns hide; three feature columns.
  - 390 px: `reports/scratch/landing-390.png` and `reports/scratch/landing-mock-390.png`, through a 390 px iframe, because headless Chrome will not size a window that narrow. One feature column; the button wraps under the email box, as in the mock.
- The sign-up's request is unchanged from the live page: the same URL, JSON body (`email`, `company` honeypot, `page`), messages and disabled state (inferred from the code; not posted, since a post would write to the live sign-up store).

PR B (measured, 2026-11-10, worktree `.worktrees/t-312`):
- Tests written first: `tests/forwarding.test.ts` (site and early-access Workers), two tests in `apps/test-agents/src/worker.test.ts` and one in `apps/demo-cloud/src/world.test.ts`. Before the Workers changed, the site test file could not load (no `apps/site/worker.js`) and both test-seller tests failed (200, not 308). The operator test passed from the start: the operators never check the Host, and the test pins that.
- `vitest run tests/forwarding.test.ts tests/spec.test.ts tests/contract apps/test-agents/src apps/operator/src/operator.test.ts apps/demo-cloud/src/world.test.ts packages/core/src/trim.test.ts examples/try.test.ts`: 11 files, 306 tests passed, after the contract test's agent-guide URL moved to crow.direct.
- `pnpm typecheck` passes; eslint on every changed code file is clean.
- `pnpm openapi` rewrote 5 description lines in `spec/openapi.json`; `pnpm validate:spec`: 34/34 examples valid, `spec/openapi.json` fresh. `spec/schemas/` is unchanged.
- `node site/build.mjs && node site/check.mjs`: site check PASS. `site/try.mjs` changed (its default operators are api.crow.direct and api2.crow.direct), and the try command in llms.txt pins its new SHA-256, `4dab4c08bea061e54f73eb54ec72ce4a43f65690fe41a6029a3aea0d3c31dd21`.
- Not run: any deploy, the try command against crow.direct, and `pnpm verify` (the kind's local checks are the site check and the touched packages' tests; CI is the gate).

## Decisions

- 2026-11-10: **the page keeps the Try line.** The mock drops it, but `site/check.mjs` (section 7) and `examples/try.test.ts` require the homepage's copied prompt for One-Click Escrow (D51). It sits with the `/llms.txt` link in one quiet line under the footer, in the footer's italic.
- 2026-11-10: **the code columns call what `examples/agent.ts` serves.** Fixed from the mock: the arbitration template is `default` with a `rubric` (the operator knows only `default` and `checks-only`; there is no `adjudicated` template and no `panel` field); an offer names `clubId`, `seller`, `buyer` and `adjudicators`, which the operator requires; `deliverable` has `description` and `format`, which the schema requires; the buyer waits for `AcceptedByAdjudicator` before it agrees, as `examples/buy-dataset.ts` does; and "what did the seller sign" reads `/v1/commitments/{id}/terms`, since `/v1/commitments/{id}` is the state only.
- 2026-11-10: **no Content-Security-Policy.** The live page sends none (no meta tag; `apps/site` has no headers file), so the new page adds none.
- 2026-11-10: **dropped from the live page, as the mock does:** the animated plate (the two agents, the escrow, the adjudicator and the bond), the typed code streams, and the old intro. `site/agent.png`, `site/bond.png` and `site/escrow.png`, which only the plate used, stay in `site/` for now.
- 2026-11-10 (PR B): **a browser sign-up on join.escrow.stream is served in place.** The brief asks for a 308 on every POST. A browser that follows a cross-origin redirect sends the next request with `Origin: null`, which the Worker refuses, and a CORS preflight cannot follow a redirect at all, so a page still open on escrow.stream could not sign up. A POST carrying an allowed site origin, and every OPTIONS, is answered in place into the same KV namespace; every other POST gets the 308 and every GET the 301.
- 2026-11-10 (PR B): **the operators advertise crow.direct** (`OPERATOR_URLS`), so discovery's `apiBaseUrl`, ciphertext URIs and `llms.txt` links name crow.direct on both hostnames. Ciphertext URIs stored before the deploy name api.escrow.stream, which keeps serving.
- 2026-11-10 (PR B): **the site's new domains attach before its new code.** A Custom Domain needs a certificate, and the test seller's crow.direct route needs crow.direct's DNS record, which the site's Custom Domain creates. So the deploy plan runs `wrangler triggers deploy` for crow-site first (the live page on the new domains, no forwarding yet), and deploys the site's code last.
- 2026-11-10 (PR B): **left on escrow.stream:** `site/visualdemo/` (a replay of the 2026-11-02 deal, a record), `examples/e2e-*` (round 1's driver), `scripts/metrics/`, `scripts/costs/` and their fixtures (they read the live API, which keeps both hostnames, and Crow Control runs them; switching them before the deploy would point them at hosts that do not answer yet), and history.
- 2026-11-10: **D40 gets a pointer, not an edit.** Its heading and record stay as history; one line above them names D56.

## Handoff

- **PR A:** in review. `CLAUDE.md`'s Map section still names "Programmatic Escrow and Arbitration" and escrow.stream, and its Start here section names control.escrow.stream, for Rafa to change (tier 3).
- **PR B:** in review, stacked on PR A. Its body holds the deploy plan, with each Worker's rollback; every step waits for Rafa.
- **For Rafa only:** confirm crow.direct is an active zone in the Cloudflare account that holds escrow.stream, before any deploy; after the move, add control.crow.direct to Crow Control's Access application and its Worker (private repository).
- **Follow-ups, after the deploy:** point `scripts/metrics/`, `scripts/costs/`, `examples/e2e-round.ts` and `config/costs.template.json` at crow.direct; update `docs/demo.md`, `docs/costs.md`, `docs/update-flow.md`, `agent-ops/` and `.claude/` (out of this lane); decide when to drop the escrow.stream hostnames; remove `site/agent.png`, `bond.png` and `escrow.png` if nothing else needs them.
