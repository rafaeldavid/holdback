# T-400: One footer on every page, and Rafa's round of page fixes

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-391 (the pages: PRs 480, 481, 485)
- **Paths this task may touch:** `site/build.mjs`, `site/check.mjs`, `site/drawer.ts`, `site/footer.ts`, `site/og.html`, `site/og.png`, `site/home.css`, `site/home.js`, `site/index.html`, `site/404.html`, `site/demo/index.html`, `site/visualdemo/index.html`, `tools/duet/replay.ts`, `tools/duet/duet.test.ts`, `tools/duet/README.md`, `apps/site/worker.js`, `site/deploy.mjs`, `tests/forwarding.test.ts`, `tests/site-deploy.test.ts`, `site/try.mjs`, `site/buy.mjs` (rebuilt banners), this file
- **Human gate:** no (the site deploy after the merge is Rafa's word)
- **Status:** review
- **Agent/session:** the T-391 session (pages owner)

## Intent

Rafa looked at the live pages on 2026-11-13 and asked for one round of changes (his words, through the coordinator, about 09:30 UTC). The site gets one footer, from one source, on every HTML page: the tagline "Verifiable settlement for AI commerce" and a quiet "Testing Now Live" pill, at the foot of the window on a short desktop page. Two value-prop lines are re-worded so they set cleanly. The demo page lines up with its header, shows whole amounts without ".00", moves "For engineers" into one Resources card that links to the repository, gives its closing block the crow mark, and drops the record sentence from its footer. The early-access form opens as a centred pop-up on desktop; a phone keeps the bottom sheet.

Display and copy only. No change to the guides, `try.mjs`, `buy.mjs`, settlement, the API or the sign-up service.

## Context

- Rafa's words, verbatim, are in the coordinator's brief (2026-11-13, about 09:30 UTC) and in the PR.
- Earlier rounds: PR 480 (light only, demo layout), PR 481 (phone fixes, drawer, Learn more wording), PR 485 (Watch Demo, drawer in `site/drawer.ts`).
- Limits that hold: the home page's HTML at most 8,000 bytes with the `llms.txt` pointer in its first 600 bytes, no inline style or script, `id="prompt"` and `join-form` present; light only; `site/check.mjs` asserts them.

## Acceptance criteria

- [x] 1. One footer, from one source, on the home page, the demo page (both views), the 404 page and `visualdemo`.
- [x] 2. On desktop the footer sits at the foot of the window when the page is shorter than the window, never over content; checked at 1280x800, 1440x900, 1920x1080 and a phone width.
- [x] 3. Footer text "Verifiable settlement for AI commerce".
- [x] 4. A quiet "Testing Now Live" pill in the footer, in ink, not green.
- [x] 5. The Private Delivery line sets on two lines at desktop widths and keeps both facts.
- [x] 6. The Your Existing Rails line leaves no single word on its last line.
- [x] 7. The demo page's body has the same width and gutters as its header and as the home page.
- [x] 8. Amounts with no cents show no decimals ("700 test dollars"); "700.50" stays; one formatter, on the decimal string.
- [x] 9. "For engineers" becomes one Resources card linking to the repository; nothing it held is lost.
- [x] 10. The closing "It's time to go direct." block carries the crow mark as a designed ending.
- [x] 11. The record sentence leaves the demo page's footer; the redaction and plain-text handling stay.
- [x] 12. The early-access form is a centred pop-up on desktop and a bottom sheet on a phone; focus kept inside, Escape and the backdrop close it, focus returns.
- [x] Checks: `node site/build.mjs && node site/check.mjs`, typecheck and tests for what changed, `pnpm lint`; `site/try.mjs` and `site/buy.mjs` hash as on `main`; the guides unchanged.
- [x] Screenshots before and after under `reports/scratch/t400/`.
- [x] 14. No logomark characters in what agents read (Rafa, about 10:00 UTC): the guides and bundles served with `charset=utf-8`; "Crow" in words in the bundles' banners and the problem pages.
- [x] 13. Link-preview cards (Rafa: "Metadata cards also need updating"): one source for every built page's title, description, Open Graph and Twitter tags; a new 1200x630 share image in the live look.

## Out of scope

- The guides, the bundles, the sign-up service, deploys.
- The animated 404 crow (saved for later).

## Evidence

All measured unless marked.

- `node site/build.mjs && node site/check.mjs`: PASS. The check now also asserts, for every page the build writes (home, 404, demo, visual walkthrough, each problem page), a title, a description, `og:title`, `og:description`, `og:url`, `og:image`, `twitter:card` `summary_large_image`, the footer with the tagline and the pill, and no `prefers-color-scheme`; and that `site/og.png` is a 1200 by 630 px PNG.
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.
- `npx vitest run tools/duet/duet.test.ts tests/site-deploy.test.ts tests/site-guides.test.ts tests/record-copies.test.ts examples/try.test.ts tests/cut-feature-alignment.test.ts`: 78 of 78 pass.
- The guides (`llms.txt`, `buy.txt`, `sell.txt`, `ref/`) have no diff against `origin/main`. The bundles differ only by their banner line (item 14).
- Home page HTML: 6,676 bytes before, 6,934 after (limit 8,000); the `llms.txt` pointer still opens the file.
- Footer at the window's foot (home page): page height equals the window and the footer's bottom edge is the window's at 1280x800, 1440x900 and 1920x1080. Demo page at 1440x900: 900 of 900 px. On a phone (375 px wide) the footer follows the content, with no sideways scroll.
- Item 5, Private Delivery, "The seller encrypts the work. Only the buyer and the reviewer can open it.": 2 lines at 1280, 1440 and 1920 px.
- Item 6, Your Existing Rails, "Fund by card or through your current payment provider.": 2 lines; the last line is "payment provider." at 1280 and 1920 px with and without the non-breaking space (the guard is not the fix; the column has the same maximum width at 1440).
- Item 7: at 1440 px the header's mark, the demo headline and the footer text all start at x = 220 px, and the demo's right edge meets the header button's at 1220 px.
- Item 8: the demo page reads "700 test dollars", "701 test dollars", "750 test dollars", "1 test dollar" (singular added); the formatter keeps two decimals when there are cents. Every amount on the page goes through it: the steps' money capsules, the facts, the specs and the FAQ answers. The home page's animation does not use it.
- Item 12: on desktop the pop-up is centred (x 503 to 937 and y 299 to 601 px in a 1440 by 900 window), takes focus in its email box, closes on Escape and on a backdrop click, and returns focus to the button; on a phone it is a bottom sheet flush with the screen's foot. No real address was sent to the sign-up service.
- Item 14: `apps/site/worker.js` names `charset=utf-8` on `text/plain` (the guides) and `text/javascript` (the bundles); Cloudflare applies a `_headers` file only to responses the asset server sends itself, and this Worker runs first (developers.cloudflare.com/workers/static-assets/headers/). `tests/forwarding.test.ts` asserts it; `site/deploy.mjs`'s live check now fails a deploy whose `llms.txt` or `try.mjs` lacks the charset (`tests/site-deploy.test.ts`). The bundles' banners say "Crow demo": each bundle differs from `main` only by that line. `try.mjs` a644cd10014c22c4c7a56f4a28d54e925feae7a242c9b586f7b0fc738d0fd411 becomes 17a953d816e55f4ef386c72cb5e071de32f6bfa812eb05b51f53e96e799f1327; `buy.mjs` d0c47f331ebce03238989c599a4c687d05e76ee49720e559d68726559a406406 becomes d66f59a4864a540c835b42413f1ae8900b06e4ccc5b117fb64b7abea8a51f4a9. The built `llms.txt`, `buy.txt` and the home page carry the new hashes and not the old ones. The try command and the buyer's install line therefore change at this deploy: a copy handed out before refuses the new file.
- Screenshots in `reports/scratch/t400/`: `before-*` and `after-*` for the home page, the demo view, the Learn more view and the 404 page at 1440x900 and 375x812, plus `og-before.png` and `og-after.png`.

## Decisions

- One module, `site/footer.ts`, holds both the footer and the card tags, since every page needs both and both change together; `site/drawer.ts` keeps the form.
- The footer and the pop-up carry their own light colours, so the demo page (its own tokens) and the home page (`home.css`) render them alike.
- The visual walkthrough stays a hand-made static file; the build adds the card and the footer as it publishes it (`visualdemoPage`), so the source stays as it was made.
- The problem pages got the card and the footer too, since the check covers every page the build writes.
- The engineers' card links to `tools/duet/README.md#the-demo-page-for-engineers` on `main` (the section this PR adds). The dated record of a demo run is not in the public repository, so the README holds what the old section said: how the page is made and rerun, the plain-words table, and the agents' tools. The run's engine, code commit and order ID stay on the page in one small line under Resources; the token's real name is a fact in the demo deal's list.
- The demo's agent names leave the demo window's top bar on desktop (they wrapped onto three lines in the narrower column); each message still names its agent. The demo headline is balanced so no word sits alone.
- The early-access pop-up is on the demo and Learn more pages; the home page has no pop-up since PR 485 (its header button is Watch Demo), so its own form is unchanged.

## Handoff

Done and verified as above; one reviewer pass. The site deploy is Rafa's word. Link previews are cached by the services that show them: after the deploy a new card or image can take hours, or a re-scrape in the service's own tool, to appear.
