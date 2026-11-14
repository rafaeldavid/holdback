# T-402: One brand kit for the site, the demo page and the pages built on it

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-400 (the footer, the drawer and the cards), T-401 (merged in `origin/main` at `1516589`)
- **Paths this task may touch:** `site/brand/` (new), `site/build.mjs`, `site/check.mjs`, `site/footer.ts`, `site/drawer.ts`, `site/home.css`, `site/index.html`, `site/404.html`, `site/demo/index.html`, `tools/duet/replay.ts`, `tools/duet/duet.test.ts`, `tests/` for assertions on the footer or the dialog, this task file
- **Human gate:** no (the site deploy after the merge is Rafa's word)
- **Status:** review
- **Agent/session:** the T-402 session, started by the coordinator on 2026-11-13
- **Roadmap row:** N103
- **Kind:** 1, copy and agent docs (`site/`), with the display code of kind 3; one reviewer pass, no red team

## Intent

Rafa asked on 2026-11-13 for one brand kit that every Crow page reads, so a change of colour or type is one edit and flows everywhere. Today the same colours and type stacks are written out four times: `site/home.css`, the demo page's inline styles in `tools/duet/replay.ts`, the footer in `site/footer.ts` and the early-access dialog in `site/drawer.ts`.

This task moves those values into one folder, `site/brand/`, and changes nothing a visitor sees. The folder holds the tokens (colours, type, space, radius, width), twelve named components with a fixed anatomy, one function per component that returns its HTML, and a short definition of each. The home page, the 404 page, the problem pages and the demo page then read the kit, and a check in `site/check.mjs` fails the build when one of them writes a colour or a font stack of its own. Crow Control and the report artifacts read the same files later (the plan's steps 2 to 4); they are not part of this task.

It is an extraction, not a redesign: no new colours, fonts, components, variants or pages. Where two pages use different values for the same role today, each keeps its look through a token or a class of its own, and the task lists each case for Rafa to settle.

The plan is `reports/crow-private/control/plans/2026-11-13-brand-kit-and-control.md` (private), sections "The kit" and "The order", step 1.

## Acceptance criteria

- [x] 1. `site/brand/tokens.css`: one `:root` block, light only, about thirty tokens named by role with the live home page's values; no `prefers-color-scheme`.
- [x] 2. `site/brand/components.css` and `site/brand/kit.mjs`: the twelve components (header bar, footer, button, pill, section head, fact, table, list row, card, notice, disclosure, dialog), class names under one prefix, no `!important`, one icon family at the home page's stroke weight. `kit.mjs` has one function per component.
- [x] 3. The footer and the dialog move into the kit; `site/footer.ts` and `site/drawer.ts` keep only what is not a component, or re-export.
- [x] 4. `site/brand/README.md`: five lines per component (purpose, anatomy, variants, states, one "do not"), then how a consumer reads the kit. No hex value in it.
- [x] 5. The home page, the 404 page, the problem pages and the demo page read the kit; a colour or a font stack is written only in `site/brand/tokens.css` (with a short allow-list, each entry explained).
- [x] 6. The guard in `site/check.mjs`, in a block of its own, fails the build on a colour or a font stack written by a consumer.
- [x] 7. No visible change: the home page, the demo page (both views), the 404 page and the problem pages compared pixel for pixel, before and after, at 1440x900 and 375x812.
- [x] 8. The home page stays within its 8,000-byte budget with the agent pointer in its first 600 bytes, `id="prompt"` and `join-form`.
- [x] 9. `site/try.mjs`, `site/buy.mjs`, `site/llms.txt`, `site/buy.txt`, `site/sell.txt` and `site/ref/` unchanged to the byte.
- [x] 10. The early-access dialog opens centred on desktop and as a sheet on a phone, closes on Escape and on a backdrop click, returns focus, and posts to the same sign-up address.
- [x] 11. A browsable kit page at `reports/scratch/t402/kit.html` (not committed, not published by this task), built from the same files.
- [x] Checks: `node site/build.mjs && node site/check.mjs`, `pnpm typecheck`, `pnpm lint`, the demo page's tests and the site tests.

## Evidence

Measured on 2026-11-13 at the branch's head, unless marked otherwise.

- **Tokens:** 42 in `site/brand/tokens.css` [measured]: 36 shared by role (11 colours, 3 for the dialog's backdrop and shadows, 3 type stacks, 5 sizes, 2 weights, 7 spaces, 3 radii, 2 widths), then 6 that keep one page's look (see Decisions). The shared values are the live home page's, except `--warn-wash`, which no page uses yet: it is mixed from `--warn` and `--page` in CSS, so it adds no new hex value.
- **Components:** the twelve, in `components.css` (sections marked `/* part: name */`) and `kit.mjs` (one function each: `headerBar`, `footer`, `button`, `pill`, `sectionHead`, `facts`, `table`, `listRows`, `card`, `notice`, `disclosure`, `dialog`) [measured]. Classes start with `ck-`; no `!important` (the guard checks it). One icon family: `.ck-icon`, 24 px box, stroke 1.6, as the home page's icons.
- **Moved, not copied:** the footer's CSS and markup and the drawer's CSS and markup now come from the kit; `site/footer.ts` keeps the tagline, the cards and `footerHtml` (a call to the kit), and `site/drawer.ts` keeps `JOIN_URL` and the script [measured, `git diff origin/main -- site/footer.ts site/drawer.ts`].
- **No visible change** [measured]: `reports/scratch/t402/shoot.mjs` (headless Chrome through the DevTools protocol, reduced motion, light scheme) shot the home page, the demo page with scripts off (both views in one page), the Learn more view, the 404 page, the problems index, one problem page, the visual walkthrough and the open dialog, at 1440x900 and 375x812, built from `origin/main` and from this branch. `reports/scratch/t402/compare.mjs` compared them pixel by pixel: 19 of 20 pairs are identical. The home page at 1440x900 differs by 380 px inside x 1180-1248, y 274-282, which is the seller's code stream; two runs of the unchanged `origin/main` page differ by 386 px in the same box, and the home page with the streams hidden is identical at both sizes. Results: `reports/scratch/t402/compare.txt`; screenshots in `before/` and `after/` there.
- **The committed demo page** (`site/demo/index.html`) was made from a run record that is not on this machine, so `reports/scratch/t402/restyle-demo.mjs` swapped only its style block, its footer, the drawer's script and one footer selector in its own script. Proof: the same swap applied to a fresh scripted run rendered by the old `replay.ts` equals the new `replay.ts`'s page byte for byte [measured].
- **The dialog** [measured, `reports/scratch/t402/after/dialog.json`]: at 1440x900 it opens centred (440x307 px at left 500, top 297), at 375x812 as a sheet (375x328 px, 0 px from the bottom), the same geometry as on `origin/main`; focus goes to the email field; Escape closes it and focus returns to the opening control; a backdrop click closes it; it posts to `https://join.crow.direct/early-access` (the request was intercepted in the page, nothing was sent).
- **Sizes** [measured, `wc -c`]: `site/index.html` 6,934 bytes before, 6,999 after (budget 8,000); `site/404.html` 3,029 before, 3,385 after (limit 4,000); `site/home.css` 9,631 before, 12,765 after (it carries the six parts the home and 404 pages use); `site/demo/index.html` 84,635 before, 86,556 after.
- **Unchanged to the byte** [measured, `git diff --quiet origin/main`]: `site/try.mjs`, `site/buy.mjs`, `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/ref/`.
- **The guard** fails on a planted `#c4161c`, `rgba(` and `Helvetica, Arial` in `tools/duet/replay.ts`, four failures with file and line [measured, then reverted].
- **Checks** [measured]: `node site/build.mjs && node site/check.mjs` PASS; `pnpm vitest run tools/duet/duet.test.ts tests/forwarding.test.ts tests/site-deploy.test.ts tests/site-guides.test.ts` 61 of 61 tests pass (the duet test runs `tsc` over `tools/duet`, hence `kit.d.mts`); `pnpm typecheck` and `pnpm lint` pass.
- **The kit page:** `reports/scratch/t402/kit.html`, 50,561 bytes, self-contained, built by `reports/scratch/t402/kit-page.mjs` from `site/brand/` alone [measured]. Not committed, not published.

## Later asks on 2026-11-13, in their own commits

- **The footer** (Rafa, through the coordinator: "the footer is not well designed and distributed based on standard Enterprise Software sites especially in mobile"). A grouped footer came first. Rafa then said: "Footer is far too big for the amount of content and the buttons are elsewhere. Maybe just keep the least of it / simplify". The footer is now one row and a slim bar. The row holds Crow and three links to pages that exist: Demo (marked current on the demo page), Agent docs, GitHub. On the home page it also holds the copy-the-prompt button. The bar holds "© 2026 Crow", the tagline and the pill. On a phone, each link is 44 px tall, and the page is 375 px wide with no sideways scroll [measured]. `site/index.html` is 7,150 bytes (budget 8,000) and `site/404.html` 3,536 bytes (limit 4,000) [measured].
- **The Hasenheide palette** (Rafa chose it in the palette research session). It is one commit to `site/brand/tokens.css`; the other files in that commit are build output. No component uses a seasonal accent yet.
  - Contrast from the tokens matches the research [measured, `reports/scratch/t402/contrast.txt`]: ink 12.4:1, ink-2 5.7:1, ink-3 3.3:1, paid 5.6:1, warn 5.8:1, accents 4.1 to 8.3:1, paid on its wash 5.4:1, warn on its wash 5.3:1.
  - Case for Rafa: `--ink-3` (3.3:1) still colours some small text: the footer's bar, "soon" on the home page, the email placeholder and the demo page's small notes. The old grey was also below 4.5:1 there.
  - Case for Rafa: `og.png` (the share image) and `site/visualdemo/` keep the white look; `--demo-bubble` stays a cool grey on the oat page.
- **The page and the accent, Rafa's rounds on 2026-11-13.**
  - The page was too dark. It now takes the palette's lighter oat, Lime-blossom white (`#faf7f0`); panels take the darker oat (`#f3eee3`).
  - The accent was then on everything. It now marks only the one filled button per view and the keyboard focus ring (README, "The accent"): autumn amber until 2026-12-01.
  - Rafa tried a lime-leaf green button (a scratch build, not committed) and kept amber.
  - Contrast [measured]: ink 13.4:1 on the page, ink-2 6.1:1, page text on the amber button 4.8:1.
  - Open, for Rafa: the panels are the beige still on the page; the demo's buyer bubble (`--demo-bubble`) is a cool grey from the white look.
- **Maple flare, Rafa's last round on 2026-11-13.** The oat still read as a knowledge tool, not an infra launch. Rafa picked trial B of two token-only trials (scratch builds): a near-white page (`#fdfcf9`), panels `#f6f3ec`, and `--accent` maple flare `#d63d00` with light text, 4.5:1 [measured]. An earlier flare with crow-black text on a lighter orange looked off and was dropped. The Learn more cards ("How the payment is held", "Built to last") now put the number or icon on the title's row (CSS only); two other layouts are previewed in `reports/scratch/t402/variations.html`.
- **The demo page's copy and cards, Rafa on 2026-11-13.**
  - The intro now reads "With Crow, any two agents can find each other and close a deal on their own: ...".
  - The second step is "Hold the payment".
  - The open-protocol card says "Crow's API builds on the Holdback open protocol. Any operator can build additional services."
  - The step cards open with a header band: the number sits in a dark tab in the card's top-left corner, with the title centred beside it.
  - Rafa kept this layout (A) over two previews: corner tabs on both sections (U), and large grey numerals (N).
  - The footer dropped the "Testing Now Live" pill; the kit keeps the pill as an option.
  - `site/index.html` is 7,105 bytes (budget 8,000); `site/404.html` is 3,491 bytes (limit 4,000) [measured].
- **The dialog** keeps its geometry and behaviour after both [measured, `reports/scratch/t402/final/dialog.json`].
- **The comparison page:** `reports/scratch/t402/diff.html` shows each page today and with the kit side by side; the screenshots are in `before/` and `final/` beside it.

## Decisions

- **Where two pages differ today, each keeps its look** (the coordinator's rule; Rafa picks later):
  1. The problem pages still wear the earlier paper look (paper background, EB Garamond, sepia links). Kept as `--problems-page`, `--problems-ink`, `--problems-ink-2`, `--problems-link` and `--problems-serif`.
  2. The demo page's buyer bubble is a grey (`--demo-bubble`) that no other page uses.
  3. The demo page's header, buttons and Learn more parts are not on the kit's parts yet; they read the tokens. They differ from the home page's: the header's gap is 20 px (home 22 px) and its mark is an inline SVG; its tall button is 44 px (home 48 px) with 22 px side padding (home 24 px); its eyebrow tracks at .04em (home .06em); its page title is 48 px and block titles 32 px.
  4. The home page's hero heading is 64 px and its lede sits 18 px below it, centred; the kit's section head (from the 404 page) is 44 px with the lede 12 px below. The hero keeps its own heading and lede; its eyebrow is the kit's.
  5. The footer pill is 24 px tall on the problem pages and the visual walkthrough, 22 px elsewhere, because those pages set no border-box sizing. The kit keeps that: it asks every page for a border-box reset instead of setting one itself.
- **Radii are 12, 18 and pill**, as the live pages draw the field, the card and the dialog. The plan's guess was 8, 14 and pill; no live part uses 8 or 14 at those roles.
- **The section head, fact, card and disclosure take one live instance's values:** the section head the 404 page's, the fact, card and disclosure the demo page's Learn more view. The card adds the plan's chevron, so its right padding is 44 px.
- **`kit.d.mts`** was added beside `kit.mjs` so the TypeScript pages typecheck against it.

## Handoff

**Done:** the kit, its definitions, the four consumers on it, the guard, the comparison. The site deploy waits for Rafa's word.

**Not done, for later:**
- Rafa picks one value for each case under Decisions, 1 to 5; then the demo page moves onto the kit's header, button, section head, fact, card and disclosure at its next `pnpm duet publish`.
- The home page's value-prop icons and the copy-the-prompt button keep home-page classes; they could read `.ck-icon` and a pill-sized button variant if Rafa wants one.
- `site/visualdemo/` and `site/og.html` keep their own colours (left as they were, by the brief).
- Crow Control and the report pages (the plan's steps 2 to 4) read `kit.mjs` at build time.

**How to resume:** read `site/brand/README.md`. To check the look again, build both trees with `--out`, then run `reports/scratch/t402/shoot.mjs` and `compare.mjs` (both scratch, on the maintainer's machine).
