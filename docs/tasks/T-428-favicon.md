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
- Looked at (measured, a screenshot in the in-app browser): 16 px PNG, 16 px SVG and 32 px PNG on a dark (`#202124`) and a light (`#dee1e6`) tab bar, and the 180 px icon with rounded corners. The crow reads at 16 px on both; the white square shows on the dark bar.

## Decisions

- The mark is drawn by a short rasteriser in `icons.mjs` (even-odd fill, 4 × 4 samples a pixel), not by a new dependency or a browser: the mark is one path of M, Q and Z commands, and the earlier favicon script (`brand/sketch/favicon.mjs`) also wrote its PNG with Node's zlib alone.
- The crow fills the square less 1.6 of 24 units each side (about 1 px at 16 px), the largest margin that keeps the crow legible at 16 px.
- The ink is the kit's `--ink` (`#2a2a2c`), read from `tokens.css`.

## Handoff

In progress. Done: the icon set and the kit's `iconLinks()`. Waiting: T-421's follow-up (pull request 532) to merge, then the site build and check change on top of it.
