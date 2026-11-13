// The site's footer and its link-preview cards (T-400, Rafa 2026-11-13): one source for every HTML page the build
// writes, so the next wording change is one edit. site/build.mjs uses it for the home page, the 404 page, the problem
// pages and the visual walkthrough; tools/duet/replay.ts for the demo page, inline so that page stays one file.
//
// The footer carries its own light colours, like the drawer, so it looks the same on every page. On a page shorter
// than the window it sits at the window's foot: the page's body becomes a column at least the window's height and the
// footer takes the space left over above it. On a longer page it simply follows the content.

/** The tagline (D56), said in words: the mark is a logo, prose says Crow. */
export const TAGLINE = 'Verifiable settlement for AI commerce';
/** The settled pitch line, in its settled order. */
export const PITCH_LINE = 'Buy from any agent. Sell to any agent.';

export const FOOTER_CSS = `/* the site's footer (site/footer.ts) */
body:has(> .foot) { min-height: 100vh; display: flex; flex-direction: column; }
body > .foot { margin-top: auto; }
.foot { --f-ink: #1d1d1f; --f-ink-2: #6e6e73; --f-ink-3: #86868b; --f-line: #d2d2d7; --f-hair: rgba(0, 0, 0, .08);
  box-sizing: border-box; width: 100%; max-width: 1040px; margin-left: auto; margin-right: auto; padding: 20px 20px 32px; border-top: 1px solid var(--f-hair);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--f-ink-3); text-align: left; }
.foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 24px; }
.foot-status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0; }
.foot-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 0 10px; border: 1px solid var(--f-line); border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--f-ink); white-space: nowrap; }
.foot-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 22px; }
.foot a { color: var(--f-ink-2); text-decoration: none; }
.foot a:hover { color: var(--f-ink); }
.foot a:focus-visible, .foot button:focus-visible { outline: 2px solid var(--f-ink); outline-offset: 2px; }
`;

/**
 * The footer: the tagline and the "Testing Now Live" pill on the left; the demo and the agent docs on the right, then
 * whatever a page adds there (the home page's copy-the-prompt button). `after` goes inside the footer, after its row.
 */
export const footerHtml = (o: { base: string; links?: string; after?: string }): string => `<footer class="foot">
<div class="foot-row">
<p class="foot-status"><span>Crow · ${TAGLINE}</span><span class="foot-pill">Testing Now Live</span></p>
<nav class="foot-links" aria-label="Footer"><a href="${o.base}demo/">Demo</a><a href="${o.base}llms.txt">Agent docs</a>${o.links ?? ''}</nav>
</div>${o.after ? `\n${o.after}` : ''}
</footer>`;

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The site's share image: 1200 by 630 px, drawn from site/og.html (its comment says how); the alt says what it shows. */
export const OG_IMAGE = { path: 'og.png', width: 1200, height: 630, alt: "Crow's mark, a crow in flight, beside the name Crow, over the lines: Verifiable settlement for AI commerce. Buy from any agent. Sell to any agent." };

/**
 * A page's description and link-preview card: the description, Open Graph and Twitter tags, all from one place.
 * `site` is the site's absolute URL with its trailing slash; `path` is the page's path under it ('' for the home page).
 */
export const cardTags = (o: { site: string; path: string; title: string; description: string }): string => {
  const url = new URL(o.path, o.site).href;
  const image = new URL(OG_IMAGE.path, o.site).href;
  return [
    `<meta name="description" content="${attr(o.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Crow">`,
    `<meta property="og:title" content="${attr(o.title)}">`,
    `<meta property="og:description" content="${attr(o.description)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${attr(OG_IMAGE.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(o.title)}">`,
    `<meta name="twitter:description" content="${attr(o.description)}">`,
    `<meta name="twitter:image" content="${attr(image)}">`,
    `<meta name="twitter:image:alt" content="${attr(OG_IMAGE.alt)}">`,
  ].join('\n');
};

/** The card text for each page, in one place. */
export const CARDS = {
  home: { path: '', title: `Crow · ${TAGLINE}`, description: `${TAGLINE}. ${PITCH_LINE}` },
  demo: { path: 'demo/', title: 'Crow · Watch two agents close a deal', description: "Two companies' agents agree the checks, set the payment aside and settle when the work passes, through Crow. A sample deal on test money." },
  notFound: { path: '', title: 'Page not found · Crow', description: `${TAGLINE}. ${PITCH_LINE}` },
  problems: { path: 'problems/', title: 'Crow · API problem types', description: "The problem types Crow's operators answer with, one page each: what went wrong and what to do next." },
  visualdemo: { path: 'visualdemo/', title: 'Crow · A deal, step by step', description: 'A real test deal on Crow, replayed: a buyer agent, a seller agent and the reviewer, every message, call and encrypted hand-off.' },
} as const;
