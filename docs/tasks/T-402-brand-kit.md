# T-402: One brand kit for the site, the demo page and the pages built on it

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-400 (the footer, the drawer and the cards), T-401 (merged in `origin/main` at `1516589`)
- **Paths this task may touch:** `site/brand/` (new), `site/build.mjs`, `site/check.mjs`, `site/footer.ts`, `site/drawer.ts`, `site/home.css`, `site/index.html`, `site/404.html`, `site/demo/index.html`, `tools/duet/replay.ts`, `tools/duet/duet.test.ts`, `tests/` for assertions on the footer or the dialog, this task file
- **Human gate:** no (the site deploy after the merge is Rafa's word)
- **Status:** in progress
- **Agent/session:** the T-402 session, started by the coordinator on 2026-11-13
- **Kind:** 1, copy and agent docs (`site/`), with the display code of kind 3; one reviewer pass, no red team

## Intent

Rafa asked on 2026-11-13 for one brand kit that every Crow page reads, so a change of colour or type is one edit and flows everywhere. Today the same colours and type stacks are written out four times: `site/home.css`, the demo page's inline styles in `tools/duet/replay.ts`, the footer in `site/footer.ts` and the early-access dialog in `site/drawer.ts`.

This task moves those values into one folder, `site/brand/`, and changes nothing a visitor sees. The folder holds the tokens (colours, type, space, radius, width), twelve named components with a fixed anatomy, one function per component that returns its HTML, and a short definition of each. The home page, the 404 page, the problem pages and the demo page then read the kit, and a check in `site/check.mjs` fails the build when one of them writes a colour or a font stack of its own. Crow Control and the report artifacts read the same files later (the plan's steps 2 to 4); they are not part of this task.

It is an extraction, not a redesign: no new colours, fonts, components, variants or pages. Where two pages use different values for the same role today, each keeps its look through a token or a class of its own, and the task lists each case for Rafa to settle.

The plan is `reports/crow-private/control/plans/2026-11-13-brand-kit-and-control.md` (private), sections "The kit" and "The order", step 1.

## Acceptance criteria

- [ ] 1. `site/brand/tokens.css`: one `:root` block, light only, about thirty tokens named by role with the live home page's values; no `prefers-color-scheme`.
- [ ] 2. `site/brand/components.css` and `site/brand/kit.mjs`: the twelve components (header bar, footer, button, pill, section head, fact, table, list row, card, notice, disclosure, dialog), class names under one prefix, no `!important`, one icon family at the home page's stroke weight. `kit.mjs` has one function per component.
- [ ] 3. The footer and the dialog move into the kit; `site/footer.ts` and `site/drawer.ts` keep only what is not a component, or re-export.
- [ ] 4. `site/brand/README.md`: five lines per component (purpose, anatomy, variants, states, one "do not"), then how a consumer reads the kit. No hex value in it.
- [ ] 5. The home page, the 404 page, the problem pages and the demo page read the kit; a colour or a font stack is written only in `site/brand/tokens.css` (with a short allow-list, each entry explained).
- [ ] 6. The guard in `site/check.mjs`, in a block of its own, fails the build on a colour or a font stack written by a consumer.
- [ ] 7. No visible change: the home page, the demo page (both views), the 404 page and the problem pages compared pixel for pixel, before and after, at 1440x900 and 375x812.
- [ ] 8. The home page stays within its 8,000-byte budget with the agent pointer in its first 600 bytes, `id="prompt"` and `join-form`.
- [ ] 9. `site/try.mjs`, `site/buy.mjs`, `site/llms.txt`, `site/buy.txt`, `site/sell.txt` and `site/ref/` unchanged to the byte.
- [ ] 10. The early-access dialog opens centred on desktop and as a sheet on a phone, closes on Escape and on a backdrop click, returns focus, and posts to the same sign-up address.
- [ ] 11. A browsable kit page at `reports/scratch/t402/kit.html` (not committed, not published by this task), built from the same files.
- [ ] Checks: `node site/build.mjs && node site/check.mjs`, `pnpm typecheck`, `pnpm lint`, the demo page's tests and the site tests.

## Evidence

(filled at handoff)

## Handoff

(filled at handoff)
