// The site's footer and its link-preview cards (T-400, Rafa 2026-11-13): one source for every HTML page the build
// writes, so the next wording change is one edit. site/build.mjs uses it for the home page, the 404 page, the problem
// pages and the visual walkthrough; tools/duet/replay.ts for the demo page, inline so that page stays one file.
//
// The footer itself is the kit's (site/brand/, T-402). On a page shorter than the window it sits at the window's
// foot; on a longer page it follows the content.

import { footer, kitCss } from './brand/kit.mjs';

/** The tagline (D56), said in words: the mark is a logo, prose says Crow. */
export const TAGLINE = 'Verifiable settlement for AI commerce';
/** The settled pitch line, in its settled order. */
export const PITCH_LINE = 'Buy from any agent. Sell to any agent.';

/** The footer's styles: the kit's pill and footer parts, with the kit's tokens on the footer itself, so the footer
 * looks the same on a page with colours of its own (the visual walkthrough). Pages that read the whole kit need none. */
export const FOOTER_CSS = kitCss({ parts: ['pill', 'footer'], scope: '.ck-foot' });

/** Where the public code lives. */
export const CODE_URL = 'https://github.com/rafaeldavid/holdback';

/**
 * The footer (T-402, Rafa 2026-11-13: laid out as an enterprise software site's): Crow and the tagline, then three
 * link groups, only to pages that exist, then the legal line and the "Testing Now Live" pill. `current` marks the
 * page's own link; `learn` and `join` are the Learn more and early-access addresses where a page has its own;
 * `joinAttrs` opens the early-access dialog where the page has one; `agents` ends the agents' group (the home page's
 * copy-the-prompt button); `after` follows the bottom bar.
 */
export const footerHtml = (o: { base: string; current?: 'demo' | 'problems'; learn?: string; join?: string; joinAttrs?: string; agents?: string; after?: string }): string =>
  footer({
    home: o.base,
    tagline: TAGLINE,
    pill: 'Testing Now Live',
    legal: '© 2026 Crow',
    groups: [
      { title: 'Product', links: [
        { href: `${o.base}demo/`, label: 'Demo', current: o.current === 'demo' },
        { href: o.learn ?? `${o.base}demo/#learn-more`, label: 'How it works' },
        { href: o.join ?? `${o.base}#join-form`, label: 'Request early access', ...(o.joinAttrs ? { attrs: o.joinAttrs } : {}) },
      ] },
      { title: 'For agents', links: [
        { href: `${o.base}llms.txt`, label: 'Agent docs' },
        { href: `${o.base}buy.txt`, label: 'Guide for buyers' },
        { href: `${o.base}sell.txt`, label: 'Guide for sellers' },
      ], ...(o.agents ? { extraHtml: o.agents } : {}) },
      { title: 'Developers', links: [
        { href: CODE_URL, label: 'Code on GitHub' },
        { href: `${o.base}problems/`, label: 'API problem types', current: o.current === 'problems' },
      ] },
    ],
    afterHtml: o.after ?? '',
  });

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
