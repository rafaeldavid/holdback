# Crow's brand kit

This folder is the only place a colour, a font stack or a component's shape is written. Every page Crow builds reads it: the home page, the 404 and problem pages, the demo page, and later Crow Control and the report pages. Change a value in `tokens.css` and it changes everywhere; `site/check.mjs` (group 15) fails the build when a page writes a colour or a font stack of its own.

The kit is light only. It has no dark theme and no component framework.

| File | Holds |
| --- | --- |
| `tokens.css` | One `:root` block: colour, type, space, radius and width, named by role. The values are there and nowhere else. |
| `components.css` | The twelve components below, each in a section marked `/* part: name */`. Every class starts with `ck-`. |
| `kit.mjs` | The CSS for a page (`kitCss`), each token's value (`TOKENS`), and one function per component that returns its HTML. |
| `kit.d.mts` | The functions' types, for the TypeScript pages. |

## The tokens

Read the names and values in `tokens.css`. In short:

- **Colour.** `--page`, `--band`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--hair`. `--paid` and `--paid-wash` mark money that moved, and nothing else. `--warn` and `--warn-wash` mark a problem. `--scrim`, `--lift` and `--lift-sheet` are the dialog's backdrop and shadows.
- **Type.** `--font`, `--display` and `--mono` are the system stacks. Five sizes, `--size-note` to `--size-display`, and two weights, `--weight-strong` and `--weight-bold`.
- **Space, radius, width.** A 4 px scale, `--space-1` to `--space-7`. Three radii: `--radius-field`, `--radius-card`, `--radius-pill`. The page is `--width` wide with a `--gutter` each side.
- **The accent.** `--accent` is maple flare, a launch orange; `--accent-ink` is the text on it. The four seasonal tokens, `--accent-spring` to `--accent-winter`, stay for small seasonal touches (a thin rule, a chart series, a drawing).
- **Kept for one page.** `--demo-bubble` and the `--problems-*` tokens keep two pages' current look until Rafa picks one value (T-402, Handoff).

## The accent

The accent marks the one thing a view asks the reader to do, and nothing else (Rafa, 2026-11-13: not on everything).

- **The filled button,** at most one per view: the home page's "Request early access", the demo page's call to action, the dialog's submit.
- **The keyboard focus ring,** where it shows only when someone tabs.
- **Never** on headings, eyebrows, icons, links, body text or a large area, and never as a state: paid and warn say states, with a word.

## The components

Each component has a fixed anatomy. A page places a part where it wants it; it never changes the part's size, padding, border or colour from outside, and the kit uses no `!important`. Icons are one family: line drawings stroked at 1.6 in the text's colour, round caps (`.ck-icon`).

**1. Header bar** (`headerBar`)
- For: the top of every page; Crow's mark and name lead home.
- Anatomy: mark, name, links, one button.
- Variants: with or without the button.
- States: links darken on hover; mark, links and button show a 2 px ink ring on keyboard focus. Links hide on a phone.
- Do not: put a second button or a search box in it.

**2. Footer** (`footer`)
- For: the foot of every page, short and quiet; it sits at the window's foot when the page is short.
- Anatomy: one row (mark and name, then a few links and at most one control), then a slim bar (legal line, tagline, pill).
- Variants: none. A link may be marked current.
- States: links darken on hover and show the focus ring; the current link is ink and strong. On a phone the links wrap and each is 44 px tall.
- Do not: link to a page that does not exist, repeat the page's own call to action, or grow it into columns of links.

**3. Button** (`button`)
- For: the one action a view asks for.
- Anatomy: label.
- Variants: filled or outlined; tall (48 px) or compact (34 px).
- States: focus ring; disabled at 60% opacity. No hover change.
- Do not: put two filled buttons side by side.

**4. Pill** (`pill`)
- For: a short state beside a title, such as "Testing Now Live" or "Refused", or money that moved.
- Anatomy: label.
- Variants: neutral, paid, warn.
- States: none; a pill is not a control.
- Do not: use paid for anything but money that moved, or colour without a word.

**5. Section head** (`sectionHead`)
- For: the top of a page or a section: what it is, then the one statement, then why it matters.
- Anatomy: eyebrow, statement heading, lede.
- Variants: with or without the eyebrow; the lede is optional.
- States: none.
- Do not: put a link or a button inside the heading.

**6. Fact** (`facts`)
- For: a few headline numbers read at a glance.
- Anatomy: value, label; facts sit in a row of four, two on a phone.
- Variants: none.
- States: none.
- Do not: put a sentence in the value; units go with the number.

**7. Table** (`table`)
- For: rows of like records with the same fields.
- Anatomy: uppercase head, hairline rows.
- Variants: none.
- States: none.
- Do not: colour a whole row; say the state in a cell, with a pill if it helps.

**8. List row** (`listRows`)
- For: a list of things to open or read, one per line.
- Anatomy: title, one line, trailing date or state.
- Variants: linked (the title is a link) or plain.
- States: a linked title underlines on hover and shows the focus ring.
- Do not: wrap the one line onto a second line on purpose; write less.

**9. Card** (`card`)
- For: a few destinations, side by side.
- Anatomy: title, one line, chevron.
- Variants: none.
- States: the border darkens on hover; focus ring.
- Do not: nest a button or a second link inside a card.

**10. Notice** (`notice`)
- For: one thing the reader must know before going on.
- Anatomy: band, title, text.
- Variants: neutral, warn.
- States: none.
- Do not: stack two notices; merge them or drop one.

**11. Disclosure** (`disclosure`)
- For: detail most readers skip: questions and answers, the full record.
- Anatomy: summary, body; a plus that turns to a dash when open.
- Variants: none.
- States: open or closed; focus ring on the summary.
- Do not: hide something the reader needs to act.

**12. Dialog** (`dialog`)
- For: one short form over the page: the early-access sign-up.
- Anatomy: title, close, form.
- Variants: centred on desktop; a sheet from the bottom on a phone (600 px wide or less).
- States: opens with focus in the form; Escape, the close button or a click outside closes it; focus returns to the control that opened it.
- Do not: put a second dialog on top of it.

## How a page reads the kit

- **The site's build** (`site/build.mjs`) writes `kitCss({ parts })` at the top of `home.css`, then the home page's own layout, and builds the header, the section head, the list rows and the footer from `kit.mjs`. The problem pages inline the pill and footer parts.
- **The demo page's builder** (`tools/duet/replay.ts`) inlines `kitCss({ parts })` into the page's one `<style>`, so the page stays one self-contained file.
- **Another repository** (Crow Control, the report pages) imports `kit.mjs` from a checkout of this repository at build time and inlines `kitCss()` into its own page. A page that must stay one file passes `mark: markDataUri()` so the header's mark needs no second file. A page with CSS variables of its own passes `scope` to put the tokens on one element instead of `:root`.
- **Every page** should set `box-sizing: border-box` on all elements, as the home and demo pages do (the problem pages and the visual walkthrough do not yet, which is why their footer pill is 2 px taller), and draws its own layout around the parts. Pages that write a colour or a font stack fail `site/check.mjs`.
