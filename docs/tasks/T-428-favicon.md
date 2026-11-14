# T-428: The crow on a white square as the favicon, on every page Crow serves

- **Lane:** infra (site and brand kit)
- **Phase:** 2
- **Depends on:** T-421's follow-up (holdback pull request 532), which owns `site/build.mjs`, `site/check.mjs` and `site/trust.mjs` until it merges
- **Paths this task may touch:** new icon files and one README line in `site/brand/`, `site/brand/kit.mjs` and `kit.d.mts` (the icon links), one small change in `site/build.mjs`, `site/trust.mjs` and `site/check.mjs` after T-421's follow-up merges, this task file; in crow-private the console's head, its Worker's icon route and a test under `control/`
- **Human gate:** no for the pull requests; the deploys run on Rafa's standing word for this wave (coordinator brief 2026-11-14, "Merge and deploy when ready")
- **Status:** in progress
- **Agent/session:** T-428 side session, started by the coordinator on 2026-11-14

## Intent

Rafa asked on 2026-11-14 for the favicon on crow.direct to show the crow on a white square, and for every other page, Crow Control included, to carry the same icon as standard. Today the home page links `crow-mark.svg`, whose path fills with `currentColor`: a browser draws it black, so it vanishes on a dark tab bar. Some pages link only `favicon.png` (an older pencil head), the 404 page and the trust and status pages link only the SVG, and the demo page carries its own data: icon.

The fix: one icon set made by one script from the mark, kept in the brand kit, linked from one function, served at each site's root, and checked by the build so a new page cannot miss it. Non-goals: changing the mark itself, the header's mark, or the guides.

## Acceptance criteria

- [ ] `site/brand/icons.mjs` writes `site/brand/icons/` from `site/crow-mark.svg`: an SVG, an `.ico` (16, 32 and 48 px), 16 and 32 px PNGs, a 180 px `apple-touch-icon.png`, 192 and 512 px PNGs and `site.webmanifest`; `--check` fails when a committed file is stale. The crow is in the kit's ink on `#ffffff`, square corners.
- [ ] Looked at 16, 32 and 180 px on a light and a dark tab bar before going on.
- [ ] `iconLinks()` in `site/brand/kit.mjs` is the one place the head's icon links are written.
- [ ] Every HTML page the site build writes carries the icon links; `/favicon.ico` and each icon file answer at the site's root.
- [ ] `site/check.mjs` fails when a built HTML page lacks the icon link or an icon file is missing, and failed before this change.
- [ ] The early-access Worker: checked whether it serves an HTML page.
- [ ] Crow Control: the console's head links the icons, its Worker serves them, `/map` and `/contracts` carry them; a test under `control/test/` covers it; the deny list's regression test passes.
- [ ] The pinned files `site/try.mjs` and `site/buy.mjs` and the guides keep their hashes.

## Out of scope

- The test agents' pages (`apps/test-agents/`, the test buyer's and test seller's own HTML pages on their own hosts): not in this task's paths; listed under Handoff.
- The demo page's own source file (`site/demo/index.html`, T-427's): the publish build puts the standard icon links into the published copy instead.

## Evidence

Labels: measured, inferred, guessed.

- Early access (measured, by reading `apps/early-access/worker.js` on `origin/main`): it answers JSON only (`POST /early-access`, `GET /version.json`, 404 JSON otherwise). It serves no HTML page, so it has no head to change. The sign-up form is a dialog on the home page.
- The icon set (measured): `node site/brand/icons.mjs` writes 8 files in 0.2 s; `--check` passes on the committed files. Sizes: `favicon.svg` 7,435 bytes, `favicon.ico` 1,681 bytes, `favicon-16.png` 299 bytes, `favicon-32.png` 546 bytes, `apple-touch-icon.png` 2,919 bytes, `icon-192.png` 3,068 bytes, `icon-512.png` 9,033 bytes.
- Every page (measured, `node site/build.mjs && node site/check.mjs`, then the same with `--out reports/site-out`): the check passes. Group 17 checks that each page carries exactly the six links of `iconLinks()` and no other icon link: the home page, 404, the trust and status pages, the visual walkthrough, the published demo page and the 16 problem pages, plus every `.html` file a publish build writes, and that each icon file sits at the build's root with the kit's bytes.
- Fails before (measured): the new check with the old `site/build.mjs` and `site/trust.mjs` reports "does not carry exactly the favicon links" for index.html, 404.html, visualdemo/index.html, trust.html, status.html and every problem page.
- `/favicon.ico` (inferred from the asset upload): the publish build writes `favicon.ico` at `reports/site-out/`, which the site Worker's static assets serve at `/favicon.ico`; the live GET after the deploy measures it.
- Pinned files and guides (measured, sha256 before and after the build): `site/try.mjs`, `site/buy.mjs`, `site/llms.txt`, `site/buy.txt`, `site/sell.txt` and every `site/ref/*.txt` unchanged.
- Lint and unit tests (measured): ESLint on the five changed scripts reports nothing; `vitest run` on the site, design-map and contract-stack tests: 86 of 86 pass.
- Crow Control (measured, crow-private pull request 64): `control/test/icons.test.mjs` 7 of 7 pass; the console's head links the icons, the Worker serves them, `/map` and `/contracts` carry them as data: URIs.
- Looked at (measured, a screenshot in the in-app browser): 16 px PNG, 16 px SVG and 32 px PNG on a dark (`#202124`) and a light (`#dee1e6`) tab bar, and the 180 px icon with rounded corners. The crow reads at 16 px on both; the white square shows on the dark bar.

## Decisions

- The mark is drawn by a short rasteriser in `icons.mjs` (even-odd fill, 4 × 4 samples a pixel), not by a new dependency or a browser: the mark is one path of M, Q and Z commands, and the earlier favicon script (`brand/sketch/favicon.mjs`) also wrote its PNG with Node's zlib alone.
- The crow fills the square less 1.6 of 24 units each side (about 1 px at 16 px), the largest margin that keeps the crow legible at 16 px.
- The ink is the kit's `--ink` (`#2a2a2c`), read from `tokens.css`.
- The committed pages must equal what the build functions render (groups 1 and 16), so the build's own pages put `FAVICON_LINKS` in their heads; the two pages kept as made (the demo, written by `pnpm duet publish`, and the visual walkthrough) go through `withIcons()`, which removes their own icon links. Group 17 walks every built HTML file, so a new page that misses the links fails the build.
- `site/favicon.png` and `site/crow-mark.svg` stay published: the header's mark is a CSS mask of `crow-mark.svg`, and old links may name `favicon.png`.

## Handoff

Done: the icon set, the kit's `iconLinks()`, the site's pages and group 17, and Crow Control (crow-private pull request 64, merged before this one so the contracts page is pushed with the icon when this merge changes `site/brand/`).

Follow-ups, not built:
- The test agents' own pages (`apps/test-agents/src/buyer.ts` and `seller.ts`, served on their own routes) have no favicon. They are another lane's files; a link to `https://crow.direct/favicon.ico` would do.
- crow-private `control/test/log.test.mjs` ("records under Waiting on Rafa become notes") fails on its `origin/main` too: it expects holdback's decisions to carry no Status line, which T-413 added.
