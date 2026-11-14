# T-421: The site's trust surfaces: a trust page, a security contact and a status page

- **Lane:** site (roadmap rows N109, "Security questionnaire answers and a trust page", and N119, "The enterprise API's written promises", in the private repository)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy and agent docs: `site/`), with a small route in the site Worker (`apps/site/worker.js`) and its test
- **Depends on:** the privacy baseline (T-416, `docs/privacy-baseline.md`), which holds the facts about what a deal reveals
- **Paths this task may touch:** this file; `site/build.mjs`, `site/check.mjs`, new files under `site/` for the new pages (`site/trust.html`, `site/status.html`, `site/pages.css`); `site/footer.ts`, for the two footer links only (see Decisions); `apps/site/` for the status relay; a new test under `tests/` for that relay; `SECURITY.md`. In the private repository, a new folder `enterprise/` (its own pull request).
- **Human gate:** the site deploy. Rafa's word for this wave, "merge and deploy when ready", covers it inside the wave brief's six limits.
- **Status:** in progress
- **Agent/session:** the T-421 session, 2026-11-14, branch `t-421-trust-surfaces`

## Intent

A company's security team checks four things before it lets its agents call an outside API: a page that says plainly how the service handles money, keys and data; a way to report a security problem; answers to its vendor questionnaire; and a status page. Crow has none of them in public today. This task adds three to crow.direct and the fourth to the private repository:

1. **A trust page** at `https://crow.direct/trust`, linked from the footer. It says where a deal's money sits, who can and cannot move it, what Crow holds and does not hold, what is public in a deal, what the operators keep and for how long, what has and has not been reviewed from outside, and how to report a problem. Every statement links to its source in the repository or on chain. It says plainly what is not there yet: no outside audit of Crow's own contracts, no certification, test network only. Values that live in code or in the deployment record (the contract addresses, the log and feedback retention) are filled in by `site/build.mjs` and compared by `site/check.mjs`.
2. **A security contact:** `https://crow.direct/.well-known/security.txt` (RFC 9116) and `SECURITY.md` at the repository's root. The contact is GitHub's private vulnerability reporting for this repository, which `SECURITY.md` already names and which is switched on (measured below).
3. **A status page** at `https://crow.direct/status`, linked from the footer: the two operators, the site, the test seller and the settlement network, each shown up or down from a plain GET, with the time of each check.
4. **Pre-filled questionnaire answers** in crow-private `enterprise/`, private, with every gap named.

Non-goals: no change to the guides' first-deal text (`site/llms.txt`, `site/buy.txt`, `site/sell.txt`), to `site/try.mjs` or `site/buy.mjs`, to `site/ref/limits.txt` (T-423's in this wave), to `site/brand/` or to the operators. No uptime target, dated API versions or activity export: those are the rest of N119.

## Acceptance criteria

From the wave brief and the done-when lines of N109 and N119, as far as this task's scope reaches:

- [ ] `https://crow.direct/trust` answers 200, and every statement on it carries a link to its source.
- [ ] The trust page says what is not there yet: no outside audit of Crow's own contracts, no certification, test network only.
- [ ] The site's one footer links the trust page and the status page, on every page the build writes.
- [ ] `https://crow.direct/.well-known/security.txt` answers 200 with Contact, Expires, Preferred-Languages, Canonical and Policy, and Expires is in the future and less than a year away.
- [ ] `SECURITY.md` gives the reporting steps and what a reporter can expect.
- [ ] `https://crow.direct/status` shows the two operators, the site, the test seller and Ethereum Sepolia, each with a state and the time of its check, from public endpoints only.
- [ ] `site/check.mjs` fails before this change and passes after it: the pages exist and are current, the footer links them, `security.txt` parses and has not expired, and no refused word appears on the new pages.
- [ ] `site/try.mjs` and `site/buy.mjs` keep their sha256.
- [ ] One `reviewer` pass that checks every claim on the trust page against its source; its findings fixed or recorded.
- [ ] Questionnaire answers in crow-private `enterprise/`, each with its source, "not yet" where that is true (separate pull request).

## Out of scope

- The rest of N109: a completed SIG Lite or CAIQ sheet and the CSA STAR Level 1 self-assessment. The answers in `enterprise/` are the short common set they draw on.
- The rest of N119: an uptime target, dated API versions with a deprecation policy, and an activity log a company can export.
- History on the status page. It keeps none: each visit checks once.
- CORS on the operators (`apps/demo-cloud/` is T-422's in this wave): the site Worker relays the operators' check instead.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- The security contact exists (measured, 2026-11-14 11:00 UTC): `gh api repos/rafaeldavid/holdback/private-vulnerability-reporting` answers `{"enabled":true}`, and `SECURITY.md` on `main` names it.
- `site/check.mjs` before the build change (measured): 13 failures, among them `site/trust.html is not what site/build.mjs renders`, `index.html's footer does not link /trust`, `site/build.mjs exports no demoPage()` and `SECURITY.md does not name the contact that security.txt names`. After: `site check PASS`, on the source build and on a publish build into `reports/site-out`.
- Tests (measured): `npx vitest run` on `tests/site-status.test.ts`, `forwarding.test.ts`, `build-info.test.ts`, `site-deploy.test.ts`, `site-guides.test.ts` and `health.test.ts`: 56 of 56 pass. `pnpm typecheck` exits 0; `eslint` on the changed files reports nothing.
- Pinned files (measured): `site/try.mjs` sha256 `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` sha256 `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, the same as `origin/main` at `12794e41`.
- Layout (measured in the app's browser, local publish build): at 375 px wide both pages are 375 px wide, with no sideways scroll; at desktop width the status table shows its four columns.
- Names (measured): the new pages and `SECURITY.md` match none of the 36 patterns in crow-private `roadmap/deny.txt`.
- Review (one `reviewer` pass, 2026-11-14): ISSUES, one High, four Medium, seven Low. All fixed in the second commit:
  - High: the page said the live operators take problem reports and keep them 90 days. They take none (measured: `GET https://api.crow.direct/v1/feedback/abc` answers 404, and discovery has no `feedback` key; `docs/operations.md`, Feedback triage). The page now says so and points to GitHub issues.
  - Medium: the Cantina claim now says April 2025 for the whole contract and July 2026 for PR 90 at the pinned commit, names PR 71 as unreviewed, and links the cross-check and the pinned submodule; the payment hold's backstop (the buyer's payment address reclaims from the escrow `expiryMarginSec` after the last decision deadline) is stated; the reviewers' and operators' signing keys, derived from a secret in the operators' Durable Object storage, are named; the reviewers' outage while the service is down is stated.
  - Low: the token store, error lines in Workers Logs, the first reviewer and the buyer as the work's recipients, the status check's regex (now refuses `//host` and any fetch outside `timed()`; measured: a mutation with `fetch('//evil.example/x')` now fails), "most failures hit both", the demo principal behind every test mandate.
- The status page's sources answer a plain GET (measured, 2026-11-14 11:00 UTC): `https://api.crow.direct/.well-known/holdback.json` and `https://api2.crow.direct/.well-known/holdback.json` answer 200 with no `access-control-allow-origin` header; `https://crow.direct/version.json` and `https://crow.direct/agents/test-seller/health` answer 200 with `access-control-allow-origin: *`; `https://eth-sepolia.blockscout.com/api/v2/...` answers 200 with `access-control-allow-origin: *`.

## Decisions

- **The status page checks from the reader's browser, and the site Worker relays the two operators.** The site, the test seller and Blockscout's public Sepolia API send `access-control-allow-origin: *`, so the page's script reads them directly. The operators send no CORS header, and adding one is T-422's lane, so the site Worker answers `GET /status/operators.json` by reading each operator's `/.well-known/holdback.json` from Cloudflare's edge. A Worker may fetch a Custom Domain on its own zone (Cloudflare's docs, Custom Domains, "Worker to Worker communication"); the operators are Custom Domains. The relay caches its answer for 15 s, so a burst of visits costs at most two operator reads every 15 s per Cloudflare location.
- **`site/footer.ts` gains two links.** The footer is one file for every page; linking the new pages from it is the only way to meet "linked from the footer". No other lane owns `site/footer.ts` in this wave.
- **`security.txt`'s Expires is set at build time, 180 days ahead.** RFC 9116 asks for less than a year. A site deploy refreshes it; a site not deployed for 180 days lets it lapse, which is the RFC's intent.

## Handoff

Built and reviewed; the live checks after the deploy go below.

- **For T-423 (`site/ref/limits.txt` is its file in this wave):** "Reporting a problem" tells agents to `POST /v1/feedback`, kept 90 days. The live operators take no reports (measured above). The trust page no longer links that section for reporting; the line in `limits.txt` stays wrong until T-423 or a later task changes it.
- **Row N109, what still stands between `enterprise/` and its done-when** (coordinator's scope note, 2026-11-14): the done-when asks for a completed SIG Lite or CAIQ and the CSA STAR Level 1 self-assessment. crow-private `enterprise/security-questionnaire.md` answers 47 common questions. A completed CAIQ v4 has about 260 questions across 17 domains (guessed from the public CAIQ; not downloaded, as the note asks); SIG Lite is a licensed Shared Assessments sheet, also not downloaded. A STAR Level 1 entry is a submission to the Cloud Security Alliance's public registry, which is Rafa's to make. Rows marked "Rafa answers" (entity, MFA, cover, staff checks, contract terms, providers' data terms) need his facts first.
- **Row N119:** only the public status page is built. No uptime target is stated (Rafa's promise to make); dated API versions, a deprecation policy and an activity export are untouched.
- **Follow-ups not built:** nothing watches the live `security.txt`'s Expires, which only a site deploy refreshes (180 days); a check in Crow Control could read it. The status page keeps no history; a history needs a store and is a different design.
