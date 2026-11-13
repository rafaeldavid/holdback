// Crow's brand kit (T-402): the tokens, the twelve components' styles, and one function per component that returns
// its HTML. site/brand/README.md defines each component. Every page Crow builds reads these files: the site's build
// (site/build.mjs), the demo page's builder (tools/duet/replay.ts) and, at build time, the private repository.
//
// Text arguments are escaped; an argument whose name ends in Html, and a button's or a footer link's `attrs`, is placed as written, so it must be the caller's own
// markup, never a visitor's or a deliverable's text.
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** tokens.css as written: one :root block. */
export const TOKENS_CSS = read('./tokens.css');
/** components.css as written, every part. */
export const COMPONENTS_CSS = read('./components.css');
/** Each token's value by name, without the leading dashes: TOKENS.ink is the ink colour. */
export const TOKENS = Object.fromEntries([...TOKENS_CSS.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const SECTIONS = Object.fromEntries(COMPONENTS_CSS.split(/^(?=\/\* part: )/m).map((s) => [/^\/\* part: ([a-z]+) \*\//.exec(s)?.[1] ?? '', s]));
/** The parts components.css holds, in its order; base always comes first. */
export const PARTS = Object.keys(SECTIONS).filter((p) => p !== 'base');

/**
 * The kit's CSS for a page: the tokens, the base, then the parts asked for (all by default). `scope` puts the tokens
 * on that selector in place of :root, for a page with variables of its own; `mark` replaces the header bar's mark
 * address, for a page that must stay one file (a data: URI from markDataUri()).
 */
export function kitCss({ parts = PARTS, scope = ':root', mark } = {}) {
  for (const p of parts) if (!SECTIONS[p]) throw new Error(`the kit has no part "${p}": it has ${PARTS.join(', ')}`);
  let css = TOKENS_CSS.replace(/^:root \{/m, `${scope} {`) + SECTIONS.base + PARTS.filter((p) => parts.includes(p)).map((p) => SECTIONS[p]).join('');
  if (mark) css = css.replaceAll('url(/crow-mark.svg)', `url("${mark}")`);
  return css;
}

/** Crow's mark (site/crow-mark.svg) as a data: URI, for a page that must stay one file. */
export const markDataUri = () => `data:image/svg+xml,${encodeURIComponent(read('../crow-mark.svg'))}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The kit's icons: one family, stroked at 1.6 in the text's colour. */
const ICON_PATHS = { chevron: '<path d="M9 5l7 7-7 7"/>', close: '<path d="M3 3l8 8M11 3l-8 8"/>' };
const ICON_BOX = { chevron: '0 0 24 24', close: '0 0 14 14' };
export const icon = (name) => `<svg class="ck-icon" viewBox="${ICON_BOX[name]}" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

/** 1. Header bar: the mark and the name linking home, then links, then at most one button. */
export const headerBar = ({ home, name = 'Crow', links = [], button }) => `<header class="ck-bar"><div class="ck-bar-in">
<a class="ck-brand" href="${esc(home)}"><span class="ck-mark" aria-hidden="true"></span>${esc(name)}</a>
<span class="ck-gap"></span>
${links.map(([href, label]) => `<a class="ck-nav" href="${esc(href)}">${esc(label)}</a>`).join('\n')}${button ? `\n${buttonHtml({ ...button, variant: 'outlined', size: 'compact' })}` : ''}
</div></header>`;

/**
 * 2. Footer: the brand block (mark, name, tagline), short link groups each under a small heading, then a bottom bar
 * with the legal line and one pill. A link may be marked current; `extraHtml` ends a group (the home page's
 * copy-the-prompt button); `afterHtml` follows the bottom bar.
 */
export const footer = ({ home, name = 'Crow', tagline, pill, legal, groups = [], afterHtml = '' }) => `<footer class="ck-foot">
<div class="ck-foot-top">
<div class="ck-foot-brand"><a class="ck-brand" href="${esc(home)}"><span class="ck-mark" aria-hidden="true"></span>${esc(name)}</a><p>${esc(tagline)}</p></div>
<nav class="ck-foot-nav" aria-label="Footer">
${groups.map((g) => `<div><h2>${esc(g.title)}</h2>${g.links.map((l) => `<a href="${esc(l.href)}"${l.current ? ' aria-current="page"' : ''}${l.attrs ? ` ${l.attrs}` : ''}>${esc(l.label)}</a>`).join('')}${g.extraHtml ?? ''}</div>`).join('\n')}
</nav>
</div>
<div class="ck-foot-bar"><span>${esc(legal)}</span>${pillHtml({ label: pill })}</div>${afterHtml ? `\n${afterHtml}` : ''}
</footer>`;

/** 3. Button: a link when it has an href, else a button. Filled or outlined; tall (48 px) or compact (34 px). */
function buttonHtml({ label, href, type = 'button', variant = 'filled', size = 'tall', attrs = '' }) {
  const cls = `ck-btn${variant === 'outlined' ? ' ck-btn-out' : ''}${size === 'compact' ? ' ck-btn-s' : ''}`;
  const extra = attrs ? ` ${attrs}` : '';
  return href ? `<a class="${cls}" href="${esc(href)}"${extra}>${esc(label)}</a>` : `<button class="${cls}" type="${esc(type)}"${extra}>${esc(label)}</button>`;
}
export const button = buttonHtml;

/** 4. Pill: a short state. Neutral, paid (money moved) or warn. */
function pillHtml({ label, tone = 'neutral' }) {
  return `<span class="ck-pill${tone === 'paid' ? ' ck-pill-paid' : tone === 'warn' ? ' ck-pill-warn' : ''}">${esc(label)}</span>`;
}
export const pill = pillHtml;

/** 5. Section head: an optional eyebrow, the statement heading, an optional lede. `level` is the heading's level. */
export const sectionHead = ({ eyebrow, title, lede, level = 1 }) => `<div class="ck-head">${eyebrow ? `<p class="ck-eyebrow">${esc(eyebrow)}</p>` : ''}<h${level} class="ck-title">${esc(title)}</h${level}>${lede ? `<p class="ck-lede">${esc(lede)}</p>` : ''}</div>`;

/** 6. Facts: a row of values, each with its label. */
export const facts = (items) => `<div class="ck-facts">${items.map(({ value, label }) => `<div class="ck-fact"><span class="ck-fact-value">${esc(value)}</span><span class="ck-fact-label">${esc(label)}</span></div>`).join('')}</div>`;

/** 7. Table: an uppercase head and hairline rows of text. */
export const table = ({ head, rows, label }) => `<table class="ck-table"${label ? ` aria-label="${esc(label)}"` : ''}><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** 8. List rows: a title (a link when it has an href), one line, and a trailing date or state. */
export const listRows = (items) => `<ul class="ck-rows">
${items.map(({ title, href, line, end }) => `<li class="ck-row">${href ? `<a class="ck-row-title" href="${esc(href)}">${esc(title)}</a>` : `<span class="ck-row-title">${esc(title)}</span>`}${line ? `<span class="ck-row-line">${esc(line)}</span>` : ''}${end ? `<span class="ck-row-end">${esc(end)}</span>` : ''}</li>`).join('\n')}
</ul>`;

/** 9. Card: a link with a title, one line and a chevron. */
export const card = ({ title, line, href }) => `<a class="ck-card" href="${esc(href)}"><span class="ck-card-title">${esc(title)}</span><span class="ck-card-line">${esc(line)}</span>${icon('chevron')}</a>`;

/** 10. Notice: a band with a title and a line of text. Neutral or warn. */
export const notice = ({ title, text, tone = 'neutral' }) => `<div class="ck-notice${tone === 'warn' ? ' ck-notice-warn' : ''}" role="${tone === 'warn' ? 'alert' : 'note'}"><p class="ck-notice-title">${esc(title)}</p><p class="ck-notice-text">${esc(text)}</p></div>`;

/** 11. Disclosure: a summary that opens its body. */
export const disclosure = ({ summary, bodyHtml }) => `<details class="ck-disc"><summary>${esc(summary)}</summary><div class="ck-disc-body">${bodyHtml}</div></details>`;

/** 12. Dialog: a title, a close button and a form; centred on desktop, a sheet from the bottom on a phone. */
export const dialog = ({ id, titleId, title, formHtml }) => `<dialog class="ck-dialog" id="${esc(id)}" aria-labelledby="${esc(titleId)}"><form class="ck-dialog-form" novalidate><div class="ck-dialog-head"><h2 class="ck-dialog-title" id="${esc(titleId)}">${esc(title)}</h2><button class="ck-dialog-close" type="button" aria-label="Close">${icon('close')}</button></div>${formHtml}</form></dialog>`;
