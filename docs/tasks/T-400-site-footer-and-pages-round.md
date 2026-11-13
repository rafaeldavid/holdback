# T-400: One footer on every page, and Rafa's round of page fixes

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-391 (the pages: PRs 480, 481, 485)
- **Paths this task may touch:** `site/build.mjs`, `site/check.mjs`, `site/drawer.ts`, `site/footer.ts`, `site/home.css`, `site/home.js`, `site/index.html`, `site/404.html`, `site/demo/index.html`, `site/visualdemo/index.html`, `tools/duet/replay.ts`, `tools/duet/duet.test.ts`, `tools/duet/README.md`, this file
- **Human gate:** no (the site deploy after the merge is Rafa's word)
- **Status:** in progress
- **Agent/session:** the T-391 session (pages owner)

## Intent

Rafa looked at the live pages on 2026-11-13 and asked for one round of changes (his words, through the coordinator, about 09:30 UTC). The site gets one footer, from one source, on every HTML page: the tagline "Verifiable settlement for AI commerce" and a quiet "Testing Now Live" pill, at the foot of the window on a short desktop page. Two value-prop lines are re-worded so they set cleanly. The demo page lines up with its header, shows whole amounts without ".00", moves "For engineers" into one Resources card that links to the repository, gives its closing block the crow mark, and drops the record sentence from its footer. The early-access form opens as a centred pop-up on desktop; a phone keeps the bottom sheet.

Display and copy only. No change to the guides, `try.mjs`, `buy.mjs`, settlement, the API or the sign-up service.

## Context

- Rafa's words, verbatim, are in the coordinator's brief (2026-11-13, about 09:30 UTC) and in the PR.
- Earlier rounds: PR 480 (light only, demo layout), PR 481 (phone fixes, drawer, Learn more wording), PR 485 (Watch Demo, drawer in `site/drawer.ts`).
- Limits that hold: the home page's HTML at most 8,000 bytes with the `llms.txt` pointer in its first 600 bytes, no inline style or script, `id="prompt"` and `join-form` present; light only; `site/check.mjs` asserts them.

## Acceptance criteria

- [ ] 1. One footer, from one source, on the home page, the demo page (both views), the 404 page and `visualdemo`.
- [ ] 2. On desktop the footer sits at the foot of the window when the page is shorter than the window, never over content; checked at 1280x800, 1440x900, 1920x1080 and a phone width.
- [ ] 3. Footer text "Verifiable settlement for AI commerce".
- [ ] 4. A quiet "Testing Now Live" pill in the footer, in ink, not green.
- [ ] 5. The Private Delivery line sets on two lines at desktop widths and keeps both facts.
- [ ] 6. The Your Existing Rails line leaves no single word on its last line.
- [ ] 7. The demo page's body has the same width and gutters as its header and as the home page.
- [ ] 8. Amounts with no cents show no decimals ("700 test dollars"); "700.50" stays; one formatter, on the decimal string.
- [ ] 9. "For engineers" becomes one Resources card linking to the repository; nothing it held is lost.
- [ ] 10. The closing "It's time to go direct." block carries the crow mark as a designed ending.
- [ ] 11. The record sentence leaves the demo page's footer; the redaction and plain-text handling stay.
- [ ] 12. The early-access form is a centred pop-up on desktop and a bottom sheet on a phone; focus kept inside, Escape and the backdrop close it, focus returns.
- [ ] Checks: `node site/build.mjs && node site/check.mjs`, typecheck and tests for what changed, `pnpm lint`; `site/try.mjs` and `site/buy.mjs` hash as on `main`; the guides unchanged.
- [ ] Screenshots before and after under `reports/scratch/t400/`.

## Out of scope

- The guides, the bundles, the sign-up service, deploys.
- The animated 404 crow (saved for later).

## Evidence

Filled in before review.

## Decisions

## Handoff
