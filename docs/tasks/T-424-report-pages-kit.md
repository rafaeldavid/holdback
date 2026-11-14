# T-424: the report pages in the brand kit

- **Lane:** report pages (the design map and the contract-stack page); the roadmap page's shell in crow-private `roadmap/page/`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 3 (display and console), from the Change recipes in `docs/team.md`; one `reviewer` pass on each pull request (the wave's rule 8)
- **Depends on:** T-402 (the brand kit, `site/brand/`, merged)
- **Paths this task may touch:** `scripts/design-map.mjs`, `scripts/contract-stack.mjs`, `tools/design-map/`, `tools/contract-stack/`, `tests/design-map.test.ts`, `tests/contract-stack.test.ts`, this file; in crow-private `roadmap/page/` only
- **Human gate:** no. The pages are Rafa's private artifacts and Crow Control's `/map` and `/contracts`; republishing them to their existing addresses is in the brief. No Worker deploy.
- **Status:** review
- **Agent/session:** T-424 in the second wave of 2026-11-14, branch `t-424-report-pages-kit`

## Intent

Rafa chose the Hasenheide palette on 2026-11-13 and the brand kit in `site/brand/` now holds every colour, font and component. The three report pages still wear the earlier paper look (EB Garamond, sepia, their own colour values). Move them onto the kit without changing what they say: each page takes the kit's tokens and header bar at build time, writes no colour or font of its own, and is republished to the address it already has. Token efficient: restyle, no new sections.

## Acceptance criteria

1. `tools/contract-stack/template.html` and `tools/design-map/template.html` write no colour (hex, `rgb()`, `hsl()`) and no font stack, and load no web font: the same rule as `site/check.mjs` group 15.
2. `build()` in each script inlines `kitCss()` (tokens, base, header bar; the pill too for the contract stack) and the kit's header bar with Crow's mark as a data URI, so each page stays one file.
3. Light only: no `prefers-color-scheme` on either page.
4. The one accent appears only as the keyboard focus ring; neither page has a filled button. State pills are the kit's neutral pill with a word.
5. The contract stack's `INPUTS` include `site/brand/` and `site/crow-mark.svg`, so Crow Control repushes `/contracts` when the kit changes.
6. Each test file asserts acceptance criteria 1 to 3 for its page; `pnpm typecheck && pnpm test` pass.
7. Each page checked at 1,024 px and 375 px wide: no horizontal page scroll (the diagrams and wide tables scroll inside their own boxes, as before).
8. The design map is republished to https://claude.ai/artifact/4nAPcSGQz6nL5mb8AuDhd2, the contract stack to its two artifacts, and the roadmap page to https://claude.ai/artifact/8qoP6eBhJ9GTcfc9Doy26i.

## Evidence

- Criteria 1 to 3 and 6: `npx vitest run tests/contract-stack.test.ts tests/design-map.test.ts`: 49 tests passed (measured, 2026-11-14). The new test fails on `origin/main`'s templates, which write colours such as `#faf7f0` and the EB Garamond stack (inferred from the templates on `origin/main`).
- Criterion 7: at 1,024 px both pages measure a document width of 1,009 px; at 375 px both measure 375 px, with no element past the right edge outside the diagram and table boxes (measured in the in-app browser, 2026-11-14).

## Handoff

- **Kit gaps:** none blocking. The kit has no state pill for "done / now / later": the pages use the neutral pill with the word, as the README says ("colour without a word" is out; paid is for money that moved).
- **Copy not changed (no new copy in this task):** the contract stack still says "audited", "nobody controls" and "Independent contract review", which the ontology of 2026-11-14 refuses as claims in new copy. A copy pass on the contract stack is a follow-up.
