// The replay page (T-391): one self-contained HTML file, generated from the run's record and nothing else, that a
// partner can read with no other page or person. It is written as a seasoned buyer would explain a purchase to a peer:
// what was bought and for how much, the agreed checks, what happened step by step, how it ended, who paid and received
// what, how long it took, and what a person had to do. Protocol names appear only behind "Exact call" disclosures;
// the "For engineers" card links to the run tool's README for the rest. Every string from the record is escaped: an
// agent's words, or anything it quoted, is shown as text, never as markup. The only network use is a link the reader
// clicks. A small inline script steps through the run; without it, every step shows.
import { kitCss, TOKENS } from '../../site/brand/kit.mjs';
import { drawerScript, JOIN_URL } from '../../site/drawer.ts';
import { CARDS, cardTags, footerHtml } from '../../site/footer.ts';
import { readFileSync } from 'node:fs';
import type { Summary } from './measures.ts';
import type { Event } from './record.ts';
import type { Over } from './tickets.ts';
import { AGENT_NAME } from './scenarios.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lane = 'buyer' | 'crow' | 'seller';

export interface Step {
  lane: Lane;
  t: number;
  /** say: an agent's own words. act: something it did. note: a refusal, a stall, the company's rule. chain: the order's record. money: money moves. end: it reported back. */
  kind: 'say' | 'act' | 'note' | 'chain' | 'money' | 'end';
  title: string;
  detail?: string;
  /** The exact call or error, for an engineer: shown behind a disclosure. */
  exact?: string;
  link?: string;
  count?: number;
  key?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …` : s);
/**
 * Base units of the 6-decimal test token, a test dollar, as test dollars: two decimals, or none when there are no
 * cents, all six when there is a part below a cent ("700 test dollars", "700.50 test dollars", "1.000001 test
 * dollars", "1 test dollar"), worked on the integer, never a float. Said as
 * dollars, never as "tokens", so no reader takes the money for AI model tokens (Rafa, 2026-11-13).
 */
const money = (amount: unknown) => {
  const a = typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : typeof amount === 'bigint' ? amount : null;
  if (a === null) return '';
  const whole = a / 1_000_000n, cents = (a % 1_000_000n) / 10_000n;
  const frac = a % 1_000_000n;
  const decimals = frac === 0n ? '' : frac % 10_000n === 0n ? `.${cents.toString().padStart(2, '0')}` : `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${whole.toLocaleString('en-US')}${decimals} ${frac === 0n && whole === 1n ? 'test dollar' : 'test dollars'}`;
};
const base = (m: J): bigint | null => (typeof m?.amount === 'string' && /^\d+$/.test(m.amount) ? BigInt(m.amount) : null);
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };

/** What an agent did, in a buyer's words. */
function act(name: string, input: J): { title: string; key: string } {
  const args: string[] = Array.isArray(input?.args) ? input.args.map(String) : [];
  if (name === 'fetch_url') {
    const p = pathOf(String(input?.url ?? ''));
    const t = /llms\.txt$/.test(p) ? "Read Crow's front page for agents" : /buy\.txt$/.test(p) ? "Read Crow's guide for buyers" : /sell\.txt$/.test(p) ? "Read Crow's guide for sellers" : /\/ref\/[a-z0-9-]+\.txt$/.test(p) ? "Read one of Crow's reference pages" : /\/sellers\//.test(p) ? "Looked at the seller's public page" : /\/v1\/commitments\//.test(p) ? 'Checked where the order stands' : /\/defaults$/.test(p) ? "Read the seller's standard terms" : /\/jobs\//.test(p) ? 'Collected the report from its own system' : /\/problems\//.test(p) ? "Read Crow's explanation of an error" : 'Read a page';
    return { title: t, key: `fetch ${p.replace(/0x[0-9a-f]{64}/g, '')}` };
  }
  if (name === 'run_command') {
    const c = String(input?.command ?? '');
    const first = args[0] ?? '';
    const t =
      c === 'buy-with-signer' ? (first === 'approve' ? 'Asked its company to approve the order and pay' : first === 'resume' ? 'Followed up on its paid order' : 'Asked the seller for a price; its buying tool read the offer and paused for approval')
      : c === 'seller-adapter' ? 'Started its selling tool, which sends offers and delivers the work'
      : c === 'adapter-log' ? 'Checked its selling tool for news'
      : c === 'check-delivery' ? 'Ran the agreed checks on a file'
      : c === 'seal' ? 'Sent the report to the buyer by hand, locked'
      : c === 'deal-record' ? 'Saved a record of the deal'
      : 'Ran one of its tools';
    return { title: t, key: `run ${c} ${c === 'adapter-log' ? '' : JSON.stringify(args)}` };
  }
  if (name === 'write_file') return { title: /^public\//.test(String(input?.path ?? '')) ? 'Published its public page' : 'Saved a file in its folder', key: `write ${input?.path}` };
  if (name === 'read_file') return { title: 'Opened a file in its folder', key: `read ${input?.path}` };
  if (name === 'list_files') return { title: 'Looked through its folder', key: 'list' };
  if (name === 'wait') return { title: 'Waited', key: 'wait' };
  return { title: 'Used a tool', key: `call ${name}` };
}

const exactOf = (name: string, input: J) => (name === 'run_command' ? `${String(input?.command ?? '')} ${(input?.args ?? []).map((x: string) => cut(String(x), 160)).join(' ')}` : name === 'fetch_url' ? `GET ${String(input?.url ?? '')}` : `${name} ${cut(JSON.stringify(input ?? {}), 300)}`);

/** A failed attempt's plain reason, from the tool's own answer. */
function reasonOf(name: string, text: string): string {
  if (text.startsWith('Refused')) return 'Its own tools did not allow this.';
  const http = /^HTTP (\d{3})/.exec(text);
  if (name === 'fetch_url' && http) return http[1] === '404' ? 'The page was not there.' : `The address answered with an error (${http[1]}).`;
  if (/failed: (no answer|could not connect)/.test(text)) return 'The address did not answer.';
  if (name === 'run_command') return 'The tool stopped with an error.';
  return 'It did not work.';
}

export function steps(events: readonly Event[]): Step[] {
  const start = events.find((e) => e.kind === 'run.start') as J;
  const t0 = start ? Date.parse(String(start.at)) - Number(start.t) : 0;
  const states = events.filter((e) => e.kind === 'chain.state') as J[];
  const price = base(states[0]?.price);
  const role = (addr: unknown) => {
    const a = String(addr ?? '').toLowerCase();
    return states.some((s) => s.buyer === a) ? 'buyer' : states.some((s) => s.seller === a) ? 'seller' : 'reviewer';
  };
  type Raw = Step & { failed?: boolean; tries?: number; base?: string };
  const lanes: Record<'buyer' | 'seller', Raw[]> = { buyer: [], seller: [] };
  const crow: Step[] = [];
  for (const e of events as J[]) {
    const side = e.role === 'buyer' || e.role === 'seller' ? (e.role as 'buyer' | 'seller') : null;
    if (side && e.kind === 'model.turn' && typeof e.text === 'string' && e.text.trim()) lanes[side].push({ lane: side, t: e.t, kind: 'say', title: cut(e.text.trim(), 900) });
    else if (side && e.kind === 'tool') {
      if (e.name === 'finish') { lanes[side].push({ lane: side, t: e.t, kind: 'end', title: `Reported back to its company: ${cut(String(e.input?.outcome ?? ''), 200)}`, ...(e.input?.report ? { detail: cut(String(e.input.report), 900) } : {}) }); continue; }
      if (e.name === 'wait') { const s = Number(e.input?.seconds ?? 0) || 0; lanes[side].push({ lane: side, t: e.t, kind: 'act', title: '', key: 'wait', count: s }); continue; }
      const a = act(e.name, e.input);
      const text = String(e.result ?? '');
      lanes[side].push({ lane: side, t: e.t, kind: 'act', title: a.title, base: a.title, key: a.key, exact: cut(exactOf(e.name, e.input), 600), ...(e.isError ? { failed: true, detail: reasonOf(e.name, text), exact: cut(`${exactOf(e.name, e.input)}\n\n${text.split('\n').filter(Boolean).slice(0, 8).join('\n')}`, 900) } : {}) });
    } else if (e.kind === 'approval') {
      const reasons: string[] = e.reasons ?? [];
      lanes.buyer.push(e.granted
        ? { lane: 'buyer', t: e.t, kind: 'note', title: "The company's standing rule approved the payment", detail: `Within the budget of ${money(e.policy?.budget)}, with the checks the company requires, and the report due within ${Math.round(Number(e.policy?.latestDeliverySec ?? 0) / 86_400)} days.` }
        : { lane: 'buyer', t: e.t, kind: 'note', title: "The company's standing rule refused to pay", detail: cut(reasons[0] ?? '', 300), ...(reasons.length > 1 ? { exact: reasons.join('\n') } : {}) });
    } else if (side && e.kind === 'stall') lanes[side].push({ lane: side, t: e.t, kind: 'note', title: 'The agent got stuck', detail: /cap/.test(String(e.reason)) ? `It used up its allowance: ${String(e.reason).replace(/^the /, '')}.` : 'It tried the same thing again and it failed the same way.', exact: cut(String(e.error ?? e.trying ?? ''), 900) });
    else if (side && e.kind === 'agent.end' && e.status !== 'finished') lanes[side].push({ lane: side, t: e.t, kind: 'end', title: e.status === 'ended' ? 'Stopped: the run was over' : e.status === 'error' ? 'Stopped: its model provider refused a request' : 'Stopped before it finished', ...(e.trying ? { exact: cut(String(e.trying), 600) } : {}) });
    else if (e.kind === 'chain.event') {
      // Order-record times are whole seconds: such a time stands for the end of its second, so an action that caused
      // the event within that second is shown before it.
      const whole = /T\d\d:\d\d:\d\dZ$/.test(String(e.at));
      const t = Number.isFinite(Date.parse(String(e.at))) ? Date.parse(String(e.at)) - t0 + (whole ? 999 : 0) : e.t;
      const link = typeof e.link === 'string' && /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]{64}$/.test(e.link) ? e.link : undefined;
      const held = base(e.amount);
      const fee = held !== null && price !== null && held > price ? held - price : null;
      const step = (kind: Step['kind'], title: string, detail?: string): Step => ({ lane: 'crow', t, kind, title, ...(detail ? { detail } : {}), ...(link ? { link } : {}), exact: String(e.type) });
      const map: Record<string, () => Step> = {
        'commitment.offered': () => step('chain', 'The seller sent a signed offer'),
        'adjudicator.accepted': () => step('chain', 'The independent reviewer agreed to check the work'),
        'commitment.agreed': () => step('chain', 'The buyer signed the agreement'),
        'hold.funded': () => step('money', `The buyer's payment is held: ${money(held)}`, `${price !== null ? `${money(price)} for the work` : 'The price'}${fee !== null ? `, ${money(fee)} for the reviewer` : ''}. Neither side can take it alone.`),
        'delivery.submitted': () => step('chain', 'The seller delivered the report, locked'),
        'key.released': () => step('chain', role(e.recipient) === 'buyer' ? 'The report unlocks for the buyer' : 'The reviewer can now open the report to check it'),
        'judgment.decided': () => step('chain', e.outcome === 'accept' ? 'The work passed the agreed checks' : e.outcome === 'reject' ? 'The work failed a required check' : 'The reviewer decided'),
        'settlement.released': () => step('money', 'The seller is paid', `${price !== null ? money(price) : 'The price'} to the seller. The report unlocks for the buyer in the same step.`),
        'settlement.refunded': () => step('money', 'The buyer is refunded', `${price !== null ? money(price) : 'The price'} back to the buyer. The report stays locked.`),
      };
      crow.push((map[e.type] ?? (() => step('chain', 'The order record changed')))());
    }
  }

  // Each agent's own steps, folded: an attempt that failed and then worked is one step that says it tried again; the
  // same action done again with nothing but waits between is one step with a count; waits next to each other add up.
  const fold = (list: Raw[]): Step[] => {
    const out: Raw[] = [];
    const lastReal = () => [...out].reverse().find((x) => x.key !== 'wait');
    const dropWaitsAfter = (x: Raw) => { for (let i = out.length - 1; i > out.indexOf(x); i--) if (out[i]!.key === 'wait') out.splice(i, 1); };
    for (const s of list) {
      if (s.key === 'wait') {
        const prev = out.at(-1);
        if (prev?.key === 'wait') prev.count = (prev.count ?? 0) + (s.count ?? 0);
        else out.push({ ...s });
        continue;
      }
      const prev = lastReal();
      const onlyWaitsSince = prev ? out.slice(out.indexOf(prev) + 1).every((x) => x.key === 'wait') : false;
      if (prev && onlyWaitsSince && s.kind === 'act' && prev.kind === 'act' && prev.base === s.base) {
        if (prev.failed && !s.failed) {
          // It did not work at first, then did: one step, with how many tries it took.
          const tries = (prev.tries ?? 1) + 1;
          Object.assign(prev, { ...s, tries, count: prev.count, detail: `${prev.detail ?? 'It did not work at first.'} It tried again${tries > 2 ? ` ${tries - 1} times` : ''}, and then it worked.`.replace('The page was not there.', 'The page was not up yet.'), failed: false });
          dropWaitsAfter(prev);
          continue;
        }
        if (prev.failed === s.failed) {
          if (s.failed) { prev.tries = (prev.tries ?? 1) + 1; dropWaitsAfter(prev); continue; }
          prev.count = (prev.count ?? 1) + 1;
          dropWaitsAfter(prev);
          continue;
        }
      }
      out.push({ ...s });
    }
    return out.map((s) => {
      if (s.key === 'wait') return { ...s, title: `Waited ${s.count} ${s.count === 1 ? 'second' : 'seconds'}` };
      const times = (s.count ?? 1) > 1 ? ` (${s.count} times)` : '';
      if (s.failed) return { ...s, kind: 'note' as const, title: `${s.title}: it did not work${(s.tries ?? 1) > 1 ? `, ${s.tries} tries` : ''}` };
      return { ...s, title: `${s.title}${times}` };
    });
  };
  const all = [...fold(lanes.buyer), ...fold(lanes.seller), ...crow];
  return all.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.i - b.i).map(({ s }) => {
    const { failed: _f, tries: _t, base: _b, ...plain } = s as Raw; // eslint-disable-line @typescript-eslint/no-unused-vars
    return plain;
  });
}

const vendorName = (v: string) => (v === 'anthropic' ? 'Anthropic' : v === 'deepseek' ? 'DeepSeek' : 'scripted');
const secs = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} ${s === 1 ? 'second' : 'seconds'}` : `${Math.floor(s / 60)} min ${s % 60} s`; };
const n = (x: number) => x.toLocaleString('en-US');
const usd = (micro: number | null) => (micro === null ? '' : `USD ${(micro / 1_000_000).toFixed(2)}`);

/** The agreed checks, one sentence each, by the IDs the audit-report terms use. */
const CHECKS: Record<string, string> = {
  report: 'The report follows the agreed format: the version reviewed, the files reviewed, and each finding with its place in the code and a fix.',
  proof: 'Every finding rated Medium or higher comes with files that prove it.',
  scope: 'Every finding points at a file in scope, at the agreed version of the code.',
  coverage: 'Every file in scope was reviewed, none left out.',
  hidden: 'The report holds no hidden characters.',
  'proof-all': 'Every finding comes with files that prove it.',
};

const ICON: Record<string, string> = {
  act: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  note: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v4M8 11.1v.15"/>',
  end: '<path d="M3.5 14.25V2M3.5 2.75h8l-1.75 3 1.75 3h-8"/>',
  chain: '<path d="M4 8.5l2.5 2.5L12 5.5"/>',
  money: '<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="2"/><circle cx="8" cy="8" r="1.75"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1.3-1.3a2.5 2.5 0 013.5 3.5L10.5 8M9 11.5l-1.3 1.3a2.5 2.5 0 01-3.5-3.5L5.5 8"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2"/>',
  sign: '<path d="M2 13.5c2-.5 3-2.5 4.5-2.5s1 2 2.5 2 2-1.5 5-1.5M10.5 2.5l2 2L6 11l-2.5.5L4 9z"/>',
  limits: '<path d="M2 4.5h12M2 11.5h12"/><circle cx="6" cy="4.5" r="1.75"/><circle cx="10.5" cy="11.5" r="1.75"/>',
};
const icon = (name: string) => `<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ICON['act']}</svg>`;

/** How the replayed run ended, as the proof beat tells it. */
export type Ending = 'paid' | 'refunded' | 'declined' | 'held' | 'stopped' | 'notstarted';

/**
 * The page's opening, in one place: the title, the descriptor, and the pitch in five labelled beats (Rafa's words,
 * 2026-11-12). A change of words is one edit here. The proof must stay true of the run the page shows: its words as
 * written fit a run where the work passed; any other ending says what that run did, naming what was bought from the
 * run's own record.
 */
export const PITCH = {
  title: 'Crow',
  descriptor: 'Buy from any agent. Sell to any agent.',
  beats: [
    { label: 'Problem', text: 'Your agents can now find almost any vendor they need, and almost any buyer for what you sell. Finding is not the hard part. Closing is. Two companies with no contract between them, and no systems connected, still have to agree what will be delivered and commit to it.' },
    { label: 'Today', text: 'So the deal goes back to people: a contract, redlines, an invoice and, when it goes wrong, a dispute. That takes days, often weeks, sometimes months. It limits your operations and your growth, even with vendors you already trust and customers who buy from you again and again.' },
    { label: 'Why now', text: 'As more work is bought and sold by agents, the companies whose agents can close a deal safely will shed that friction and pull ahead of their peers.' },
    { label: 'The new way', text: 'With Crow, the two agents agree the acceptance checks up front, within the limits each company sets. The payment is set aside before the work starts. When the work passes the checks, the seller is paid and the buyer receives the work, in the same step.' },
  ],
  proofLabel: 'Proof',
  /** The proof beat for this run: Rafa's sentence when the work passed, and what happened instead otherwise. */
  proof(ended: Ending, item: string): string {
    if (ended === 'paid') return `See it happen. Below, one agent buys ${item} from another. It orders, the seller delivers, the work is checked, and the seller is paid the moment it passes.`;
    if (ended === 'refunded') return `See it happen. Below, one agent buys ${item} from another. It orders, the seller delivers, the work is checked and fails, and the buyer gets its money back. The work stays locked.`;
    if (ended === 'declined') return `See it happen. Below, one agent asks another for ${item}. The offer breaks the limits its company set, so it walks away. Nothing is signed and nothing is paid.`;
    if (ended === 'held') return `See it happen. Below, one agent buys ${item} from another. The payment is set aside, but the run stopped before the work was checked, so the payment is still set aside.`;
    if (ended === 'notstarted') return `See it happen. Below, one agent tries to buy ${item} from another. This run did not start: one agent's AI provider refused its first request, so nothing was ordered or paid.`;
    return `See it happen. Below, one agent tries to buy ${item} from another. The run stopped before an order was placed, so nothing was paid.`;
  },
};

/**
 * The demo page's opening (Rafa, 2026-11-12): a headline, a short intro and the demo's one label. The longer pitch
 * (PITCH) moved to the About section of Learn more.
 */
export const HERO = {
  headline: "It's time to go direct.",
  intro: 'Your agents can find almost any vendor, and almost any buyer. With Crow, two agents close the deal on their own: they agree the checks up front, the payment is set aside before the work starts, and the seller is paid the moment the work passes. Watch one deal below.',
  demoLabel: 'Sample Crow Test Demo',
  learnIntro: 'Two companies\' agents agree the checks, the payment is set aside, and the seller is paid the moment the work passes. Here is how it works, and the details of the demo deal: one sample purchase between two agents.',
  closing: 'Live in early access on test money.',
};
/**
 * Crow's mark: a crow in flight, as the crow flies (Rafa, 2026-11-12). One path, read from crow-mark.svg beside this
 * file (where it came from is in README.md, "The mark"), drawn in the text's colour for the header and the tab icon.
 */
export const CROW_MARK = /\sd="([^"]+)"/.exec(readFileSync(new URL('./crow-mark.svg', import.meta.url), 'utf8'))?.[1] ?? '';
const markSvg = (fill: string, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true"><path fill="${fill}" fill-rule="evenodd" d="${CROW_MARK}"/></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(markSvg(TOKENS.ink ?? '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;

/** Where "Request early access" goes: the sign-up form on Crow's site. */
export const EARLY_ACCESS = 'https://crow.direct/#join-form';
/** The sign-up service the drawer posts to: the home page's own (site/drawer.ts). */
export const JOIN = JOIN_URL;
/** Where the engineers' card goes: the run tool's README, which holds what the old "For engineers" section said. */
export const ENGINEERS = 'https://github.com/rafaeldavid/holdback/blob/main/tools/duet/README.md#the-demo-page-for-engineers';

export interface PageExtras {
  /** Measures over their limits, and the ticket written for them. */
  over?: readonly Over[];
  ticket?: string | null;
  /**
   * For crow.direct/demo: early access goes to the home page's own sign-up form (same site), and every local path
   * and every long hex string (deal IDs, addresses) is shortened, so the published page names no folder on this
   * machine and carries nothing a secret scanner reads as a key.
   */
  publish?: boolean;
}


/** The published page's text: local paths cut to the run's own part, long hex strings to their ends. */
export function forPublishing(html: string): string {
  return html
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s"'<>&]+/g, (p) => { const tail = /(\/(?:buyer|seller)\/.*)$/.exec(p)?.[1]; return `…${tail ?? `/${p.split('/').pop() ?? ''}`}`; })
    .replace(/0x([0-9a-fA-F]{6})[0-9a-fA-F]{30,}([0-9a-fA-F]{4})(?![0-9a-fA-F])/g, '0x$1…$2');
}

export function replayPage(events: readonly Event[], s: Summary, extras: PageExtras = {}): string {
  const html = page(events, s, extras);
  return extras.publish ? forPublishing(html) : html;
}

function page(events: readonly Event[], s: Summary, extras: PageExtras): string {
  const EARLY = extras.publish ? '/#join-form' : EARLY_ACCESS;
  // The mark links home, as on the home page: the site's root when published, crow.direct in a standalone replay.
  const HOME = extras.publish ? '/' : 'https://crow.direct/';
  const FOOT = footerHtml({ base: HOME, current: 'demo' });
  const AFTER = s.notStarted ? `<p class="after">This run did not start: the ${esc(AGENT_NAME[s.notStarted.role === 'seller' ? 'seller' : 'buyer'])}'s AI provider refused its first request, so nothing was ordered or paid.</p>` : '';
  const start = events.find((e) => e.kind === 'run.start') as J;
  const world = events.find((e) => e.kind === 'world') as J;
  const states = events.filter((e) => e.kind === 'chain.state') as J[];
  const chain = events.filter((e) => e.kind === 'chain.event' && (e as J).commitmentId === s.outcome.commitmentId) as J[];
  const stop = (events.find((e) => e.kind === 'signer.stop' && (e as J).commitmentId === s.outcome.commitmentId) ?? events.find((e) => e.kind === 'signer.stop')) as J;
  const end = events.at(-1);
  const list = steps(events);
  const scripted = s.models.buyer.vendor === 'scripted' && s.models.seller.vendor === 'scripted';
  const model = (r: 'buyer' | 'seller') => (s.models[r].vendor === 'scripted' ? 'A scripted stand-in, no AI model' : `${vendorName(s.models[r].vendor)} ${s.models[r].model.replace(/@.*$/, '')}`);
  const local = world?.local !== false;
  const testnet = !local && Number(world?.chainId) === 11155111;
  const where = local ? 'a local test setup on one computer, with test money' : testnet ? 'the Sepolia public test network, with test money' : `a test network (chain ${String(world?.chainId ?? '')}), with test money`;

  const price = base(states[0]?.price);
  const held = base(chain.find((e) => e.type === 'hold.funded')?.amount);
  const fee = held !== null && price !== null && held > price ? held - price : null;
  const paidSeller = chain.some((e) => e.type === 'settlement.released');
  const refunded = chain.some((e) => e.type === 'settlement.refunded');
  const scope = start?.scope as { files?: string[]; lines?: number } | undefined;
  // How the run ended, for the proof beat: settled either way, a refused offer, a held payment, or stopped earlier.
  const ending: Ending = s.notStarted ? 'notstarted' : paidSeller ? 'paid' : refunded ? 'refunded' : held !== null ? 'held' : events.some((e) => e.kind === 'signer.stop') && (events.find((e) => e.kind === 'agent.end' && e.role === 'buyer') as J)?.status === 'finished' ? 'declined' : 'stopped';
  const boughtItem = String(start?.item ?? (scope?.files?.length ? 'a software security audit' : 'a piece of work'));
  const bought = `A security review of ${scope?.files?.length ?? 'several'} smart-contract files (${n(Number(scope?.lines ?? 0))} lines), written as a report`;
  const outcome = paidSeller ? 'The work passed. The seller was paid and the buyer received the report.' : refunded ? 'The work failed a required check. The buyer got the price back and the report stayed locked.' : 'No order was placed. Nothing was signed and nothing was paid.';
  const ok = s.decisionRight;
  const policy = start?.policy ?? {};
  const days = Math.round(Number(policy.latestDeliverySec ?? 0) / 86_400);
  const approvals = s.ownerApprovals;

  const avatar = (r: 'buyer' | 'seller') => `<span class="avatar ${r}" aria-hidden="true">${r === 'buyer' ? 'P' : 'S'}</span>`;
  const exact = (x?: string) => (x ? `<details><summary>Exact call</summary><pre>${esc(x)}</pre></details>` : '');
  /** One step of the full record (Learn more): times, details and the exact call behind a disclosure. */
  const item = (st: Step, i: number) => {
    const side = st.lane;
    if (st.kind === 'say') return `<li class="step ${side} say" data-i="${i}"><div class="bubble"><p>${esc(st.title)}</p></div><span class="meta">${AGENT_NAME[side === 'seller' ? 'seller' : 'buyer']} · ${secs(Math.max(0, st.t))}</span></li>`;
    if (side === 'crow') return `<li class="step crow ${st.kind}" data-i="${i}"><div class="capsule">${icon(st.kind === 'money' ? 'money' : 'chain')}<span><strong>${esc(st.title)}</strong>${st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}${st.link ? `<a class="sub" href="${esc(st.link)}" rel="noopener" target="_blank">See the payment record</a>` : ''}</span><span class="time">${secs(Math.max(0, st.t))}</span></div></li>`;
    return `<li class="step ${side} ${st.kind}" data-i="${i}"><div class="action">${icon(st.kind === 'note' ? 'note' : st.kind === 'end' ? 'end' : 'act')}<span><span class="title">${esc(st.title)}</span>${st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}${exact(st.exact)}</span></div></li>`;
  };
  /** One step of the demo: the same words, without times, details or calls, so the conversation reads at a glance. */
  const demoItem = (st: Step) => {
    const side = st.lane;
    if (st.kind === 'say') return `<li class="step ${side} say"><div class="bubble"><p>${esc(st.title)}</p></div><span class="meta">${AGENT_NAME[side === 'seller' ? 'seller' : 'buyer']}</span></li>`;
    if (side === 'crow') return `<li class="step crow ${st.kind}"><div class="capsule">${icon(st.kind === 'money' ? 'money' : 'chain')}<span><strong>${esc(st.title)}</strong>${st.kind === 'money' && st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}</span></div></li>`;
    return `<li class="step ${side} ${st.kind}"><div class="action">${icon(st.kind === 'note' ? 'note' : st.kind === 'end' ? 'end' : 'act')}<span><span class="title">${esc(st.title)}</span>${st.kind === 'note' && st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}</span></div></li>`;
  };
  const demoList = list.filter((st) => st.key !== 'wait');

  const checks: Array<{ id: string; required: boolean }> = Array.isArray(stop?.checks) ? stop.checks : [];
  const checkList = checks.length
    ? `<ul class="checks">${checks.map((c) => `<li>${icon('chain')}<span>${esc(CHECKS[c.id] ?? `The check named “${c.id}”.`)}${c.required ? '' : ' (advisory: it does not decide on its own)'}</span></li>`).join('')}</ul>`
    : '<p>No offer reached the buyer, so no checks were agreed.</p>';

  const tok = (r: 'buyer' | 'seller') => s.tokens[r].input + s.tokens[r].output;
  const forbidden = s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove;
  const measures = [
    ['The right outcome', ok ? `Yes. ${outcome}` : `No: not what this test expected. ${s.why}.`],
    ['What each company told its agent', s.brief === 'direct' ? `Only what it wanted, its limits and its own setup, and that it pays or sells through crow.direct. Each agent found Crow's guides from the home page on its own.${local ? " In this test, crow.direct was answered from this machine's copy of the site." : ''}` : "Where Crow's guides are and how to use them, with what it wanted, its limits and its own setup."],
    ['From the work passing to the seller being paid', s.workPassesToPaidSec === null ? (s.workPassesToPaidNote ?? 'Nobody was paid in this run.') : `${s.workPassesToPaidSec} s, counted on the order record in whole seconds.`],
    ['People involved during the run', `${s.humanInterventions}. ${approvals.length ? `The buyer set one standing rule in advance; it answered ${approvals.length} approval ${approvals.length === 1 ? 'request' : 'requests'}.` : 'Nobody acted during the run.'}`],
    ['AI model tokens used', `${n(s.tokens.deal)} in all: ${n(s.tokens.split.fresh)} fresh input, ${n(s.tokens.split.cacheRead)} read again from the providers' cache (billed at a fraction of the price), ${n(s.tokens.split.cacheWrite)} written to it, and ${n(s.tokens.split.output)} written by the agents.${s.costPerDealMicroUsd !== null ? ` At list prices, about ${usd(s.costPerDealMicroUsd)} for the deal.` : ''} The ${AGENT_NAME.buyer} used ${n(tok('buyer'))}: ${n(s.tokens.buyer.guides)} to read Crow's guides and keep them in mind, ${n(s.tokens.buyer.work)} for the purchase itself. The ${AGENT_NAME.seller} used ${n(tok('seller'))}: ${n(s.tokens.seller.guides)} for the guides, ${n(s.tokens.seller.work)} for the sale. The most either carried at once: ${n(s.peakContext.buyer)} tokens (buyer), ${n(s.peakContext.seller)} (seller).${scripted ? ' Scripted stand-ins count text length divided by four.' : ''}`],
    ['Steps the agents took', `${n(s.calls.buyer.turns + s.calls.seller.turns)} steps and ${n(s.calls.buyer.toolCalls + s.calls.seller.toolCalls)} actions; ${n(s.calls.buyer.refused + s.calls.seller.refused)} were stopped by the agents' own tools.`],
    ['Times an agent got stuck', s.stalls.length ? `${s.stalls.length}. ${s.stalls.map((x) => `The ${AGENT_NAME[x.role as 'buyer' | 'seller'] ?? x.role}: ${x.reason}.`).join(' ')}` : '0. Neither agent repeated a failing step or ran out of allowance.'],
    ['Agreed to terms the buyer ruled out', forbidden ? (s.forbiddenTerms.funded ? `Yes. The ${AGENT_NAME.buyer} paid for terms the buyer ruled out.` : `Yes. The ${AGENT_NAME.buyer} asked to approve terms the buyer ruled out; the buyer's standing rule refused.`) : `No. The ${AGENT_NAME.buyer} approved only terms the buyer allows.`],
  ];
  const overList = extras.over ?? [];

  const id = s.outcome.commitmentId;
  const liveOrder = !local && id && Array.isArray(world?.operators) && typeof world.operators[0] === 'string' && /^https:\/\/[^\s"']+$/.test(world.operators[0]) && /^0x[0-9a-f]{64}$/.test(id) ? `${world.operators[0]}/v1/commitments/${id}` : null;
  const txLinks = chain.filter((e) => typeof e.link === 'string' && /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]{64}$/.test(e.link));
  const resource = (href: string, label: string, note: string) => `<a class="resource" href="${esc(href)}" rel="noopener" target="_blank"><span class="resource-title">${esc(label)} ›</span><span class="resource-note">${esc(note)}</span></a>`;
  const spec = (label: string, value: string) => `<div class="spec"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const faq = (q: string, body: string) => `<details class="faq"><summary>${esc(q)}</summary><div class="faq-body">${body}</div></details>`;
  const p = (text: string) => `<p>${esc(text)}</p>`;
  const fact = (value: string, label: string) => `<div class="fact"><span class="fact-value">${esc(value)}</span><span class="fact-label">${esc(label)}</span></div>`;
  const runSeconds = end ? Math.round(Number(end.t) / 1000) : 0;
  const honest = `${scripted ? 'Both agents in this sample are scripted stand-ins that follow a fixed list of steps: it shows how the pieces fit, not what an AI model would do.' : `The ${AGENT_NAME.buyer} is ${model('buyer')} and the ${AGENT_NAME.seller} is ${model('seller')}: real AI models${s.models.buyer.vendor !== s.models.seller.vendor ? ' from two different companies' : ''}, each using only its own tools. They never talked to each other directly.`}`;
  const testMoney = local ? 'This demo is a test run on a local test setup, with test money. No real money moved, and there are no public records of it.' : `This demo is a test run on ${where}. No real money moved.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(CARDS.demo.title)}</title>
${cardTags({ site: 'https://crow.direct/', ...CARDS.demo })}
<link rel="icon" href="${FAVICON}">
<style>
/* One neutral family and one accent. The accent (ink) is kept for the primary action; the conversation is neutral;
   green means money moved and nothing else. */
${kitCss({ parts: ['button', 'pill', 'footer', 'dialog'] })}:root{--r-sm:6px;--r-md:8px;--r-lg:10px;--r-win:var(--radius-field);--r-card:var(--radius-card);--arrive:cubic-bezier(.25,.8,.25,1)}
*{box-sizing:border-box}
html,body{margin:0;background:var(--page);color:var(--ink);font:16px/1.5 var(--font);-webkit-font-smoothing:antialiased}
a{color:inherit}
.toolbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--page) 92%,transparent);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--hair)}
.toolbar-inner{max-width:1040px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:20px}
.app{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px;color:var(--ink);text-decoration:none;line-height:1.2}.app .mark{width:30px;height:30px;flex:none}
.spacer{flex:1}
.navlink{font-size:14px;color:var(--ink-2);text-decoration:none}.navlink:hover{color:var(--ink)}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:inherit;font-size:16px;font-weight:600;text-decoration:none;border:1px solid var(--accent);cursor:pointer}
.button.quiet{min-height:34px;padding:0 16px;font-size:14px;background:transparent;color:var(--ink);border-color:var(--line)}
.textlink{font-size:16px;font-weight:500;color:var(--ink);text-decoration:none}.textlink:hover{text-decoration:underline}
main{max-width:1040px;margin:0 auto;padding:56px 20px 72px}
.hero{text-align:center;max-width:720px;margin:0 auto}
.headline{font-family:var(--display);font-size:56px;line-height:1.05;font-weight:700;letter-spacing:-.03em;margin:0}
.intro{font-size:20px;line-height:1.45;color:var(--ink-2);margin:16px auto 0;max-width:640px}
.cta{display:flex;gap:24px;justify-content:center;align-items:center;margin-top:28px}
.demo{margin:48px auto 0;max-width:860px;background:var(--band);border-radius:var(--r-card);overflow:hidden}
.demo-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--hair)}
.demo-label{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--ink-2);text-transform:uppercase}
.demo-heads{flex:1;display:flex;justify-content:center;gap:20px;font-size:12px;color:var(--ink-2)}
.demo-heads span{display:flex;align-items:center;gap:6px}
.icon-button{width:32px;height:32px;border-radius:999px;border:1px solid var(--line);background:var(--page);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.icon-button svg{width:12px;height:12px;fill:currentColor}
.icon-button[hidden]{display:none}
.demo-frame{height:min(64vh,600px);overflow-y:auto;padding:20px 16px 28px;scroll-behavior:smooth}
.after{text-align:center;font-size:15px;color:var(--ink-2);margin:20px 0 0}
#demo-view[hidden]{display:none}
@media (min-width:980px){#demo-view{max-width:1040px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:56px;align-items:center;padding-top:24px;padding-bottom:24px}#demo-view .hero{text-align:left;margin:0}#demo-view .headline{font-size:52px;text-wrap:balance}#demo-view .demo-heads span{display:none}#demo-view .intro{margin-left:0;font-size:19px}#demo-view .cta{justify-content:flex-start}#demo-view .after{text-align:left}#demo-view .demo{margin:0;max-width:none}#demo-view .demo-frame{height:clamp(300px,calc(100vh - 176px),640px)}}
.avatar{width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:1px solid var(--line);background:var(--page);color:var(--ink)}
.avatar.seller{background:var(--ink);color:var(--page);border-color:var(--ink)}
ol.run{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.step{display:flex;flex-direction:column;max-width:72%}
.step.buyer{align-self:flex-start;align-items:flex-start}.step.seller{align-self:flex-end;align-items:flex-end}
.step.crow{align-self:center;max-width:88%;margin:6px 0}
.step.pending{display:none}
.step.reveal{animation:arrive .8s var(--arrive) both}
@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.bubble{border-radius:18px;padding:9px 14px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.4}.bubble p{margin:0}
.buyer .bubble{background:var(--demo-bubble);color:var(--ink);border-bottom-left-radius:6px}
.seller .bubble{background:var(--page);color:var(--ink);border:1px solid var(--line);border-bottom-right-radius:6px}
.typing .bubble{display:flex;gap:4px;padding:12px 14px}
.typing .bubble i{width:7px;height:7px;border-radius:999px;background:var(--ink-3);opacity:.5;animation:blink 1.2s infinite}
.typing .bubble i:nth-child(2){animation-delay:.2s}.typing .bubble i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:.85}}
.meta{font-size:11px;color:var(--ink-3);margin:3px 8px 0}
.action{display:flex;gap:8px;align-items:flex-start;color:var(--ink-2);font-size:13px;padding:2px 8px}
.seller .action{flex-direction:row-reverse;text-align:right}
.action .title{display:block;color:var(--ink-2)}
.sub{display:block;font-size:12px;color:var(--ink-3);overflow-wrap:anywhere;white-space:pre-wrap}
.note .action,.end .action{background:var(--page);border:1px solid var(--hair);border-radius:var(--r-lg);padding:8px 12px}
.note .action .title,.end .action .title{color:var(--ink);font-weight:600}
.glyph{width:16px;height:16px;flex:0 0 16px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.capsule{display:flex;align-items:center;gap:10px;background:var(--page);border:1px solid var(--hair);border-radius:999px;padding:7px 14px;font-size:13px;color:var(--ink)}
.capsule strong{font-weight:600}.capsule .time{font-size:11px;color:var(--ink-3);white-space:nowrap}
.money .capsule{background:var(--paid-wash);border-color:transparent;border-radius:var(--r-win);padding:10px 16px}.money .capsule .glyph{color:var(--paid)}
.capsule a{color:var(--ink);text-decoration:underline}
/* Learn more: a product page. */
.back{font-size:14px;color:var(--ink-2);text-decoration:none}
.page-hero{max-width:720px;margin:12px 0 0}
.eyebrow{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin:0}
.page-title{font-family:var(--display);font-size:48px;line-height:1.08;font-weight:700;letter-spacing:-.025em;margin:8px 0 0}
.page-intro{font-size:20px;line-height:1.45;color:var(--ink-2);margin:14px 0 0}
.honest{font-size:13px;color:var(--ink-3);margin:14px 0 0}
.block{margin-top:72px}
.block-title{font-family:var(--display);font-size:32px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:0 0 24px}
.block-lead{font-size:17px;line-height:1.5;color:var(--ink-2);margin:-12px 0 24px;max-width:680px}
.beats{border-top:1px solid var(--line)}
.beat{display:grid;grid-template-columns:180px 1fr;gap:24px;padding:20px 0;border-bottom:1px solid var(--line)}
.beat-label{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);padding-top:3px}
.beat p{margin:0;font-size:18px;line-height:1.5;max-width:640px}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.steps li{background:var(--band);border-radius:var(--r-card);padding:22px 20px}
.step-num{display:inline-flex;width:28px;height:28px;border-radius:999px;align-items:center;justify-content:center;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:700}
.steps h4,.feature h4{font-size:17px;font-weight:600;margin:14px 0 6px}
.steps p,.feature p{margin:0;font-size:15px;color:var(--ink-2)}
.features{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.feature{border:1px solid var(--line);border-radius:var(--r-card);padding:24px}
.feature .glyph{width:22px;height:22px;flex:none;color:var(--ink)}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:28px}
.fact{padding:20px 16px 20px 0;display:flex;flex-direction:column;gap:2px}
.fact+.fact{border-left:1px solid var(--line);padding-left:16px}
.fact-value{font-family:var(--display);font-size:26px;font-weight:700;letter-spacing:-.01em}
.fact-label{font-size:13px;color:var(--ink-2)}
dl.specs{margin:0;display:grid;grid-template-columns:repeat(2,1fr);gap:0 32px}
.spec{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:14px 0;border-bottom:1px solid var(--hair)}
.spec dt{font-size:14px;color:var(--ink-2)}.spec dd{margin:0;font-size:15px;overflow-wrap:anywhere}
.faqs{border-top:1px solid var(--line)}
.faq{border-bottom:1px solid var(--line)}
.faq>summary{list-style:none;cursor:pointer;padding:20px 32px 20px 0;font-size:18px;font-weight:600;position:relative}
.faq>summary::-webkit-details-marker{display:none}
.faq>summary::after{content:"+";position:absolute;right:4px;top:16px;font-size:24px;font-weight:300;color:var(--ink-2)}
.faq[open]>summary::after{content:"–"}
.faq-body{padding:0 0 22px;max-width:720px;color:var(--ink-2);font-size:16px}
.faq-body p{margin:0 0 10px}
ul.checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
ul.checks li{display:flex;gap:10px;align-items:flex-start;color:var(--ink)}
ul.checks .glyph{color:var(--paid);margin-top:3px}
.measures{margin:0;padding:0;list-style:none}
.measures li{padding:10px 0;border-bottom:1px solid var(--hair)}.measures li strong{display:block;color:var(--ink);font-weight:600}
details.record{margin-top:16px}
details.record>summary{list-style:none;cursor:pointer;font-size:16px;font-weight:600}
details.record>summary::-webkit-details-marker{display:none}
details.record>summary::before{content:"› ";color:var(--ink-2)}
details.record[open]>summary::before{content:"⌄ "}
.conversation{background:var(--band);border-radius:var(--r-card);padding:20px 16px;margin-top:16px}
.heads{display:flex;justify-content:space-between;padding:0 4px 12px;border-bottom:1px solid var(--hair);margin-bottom:12px;font-size:13px;color:var(--ink-2)}
.heads span{display:flex;align-items:center;gap:8px}
.step details{margin-top:4px;font-size:12px;color:var(--ink-3)}.step details summary{cursor:pointer;list-style:none}.step details summary::-webkit-details-marker{display:none}.step details summary::before{content:"› "}
pre{font-family:var(--mono);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--page);border-radius:var(--r-sm);padding:8px;margin:4px 0 0;text-align:left;color:var(--ink-2)}
.resources{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.resource{display:flex;flex-direction:column;gap:6px;padding:20px;border:1px solid var(--line);border-radius:var(--r-card);text-decoration:none}
.resource:hover{border-color:var(--ink-2)}
.resource-title{font-weight:600}.resource-note{font-size:14px;color:var(--ink-2)}
.small{font-size:13px;color:var(--ink-3);margin:12px 0 0}
.closing{margin-top:72px;background:var(--band);border-radius:var(--r-card);padding:56px 24px 52px;text-align:center}
.closing .closing-mark{display:block;width:56px;height:56px;margin:0 auto 18px;color:var(--ink)}
.closing h3{font-family:var(--display);font-size:32px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:0}
.closing p{color:var(--ink-2);margin:10px 0 22px}
@media (max-width:820px){.steps{grid-template-columns:repeat(2,1fr)}.facts{grid-template-columns:repeat(2,1fr)}.fact:nth-child(3){border-left:0;padding-left:0}.resources{grid-template-columns:1fr 1fr}dl.specs{grid-template-columns:1fr}}
@media (max-width:600px){.headline{font-size:40px}.intro,.page-intro{font-size:18px}.page-title{font-size:36px}.demo-heads,.navlink{display:none}.step{max-width:88%}.steps,.features,.resources{grid-template-columns:1fr}.beat{grid-template-columns:1fr;gap:6px}.spec{grid-template-columns:1fr;gap:2px}main{padding-top:36px}}
@media (prefers-reduced-motion:reduce){.demo-frame{scroll-behavior:auto}.step.reveal{animation:none}.typing .bubble i{animation:none}}
</style>
</head>
<body>
<div class="toolbar"><div class="toolbar-inner"><a class="app" href="${esc(HOME)}">${markSvg('currentColor', 'mark')}<span>${esc(PITCH.title)}</span></a><div class="spacer"></div><a class="navlink" href="#learn-more">Learn more</a><a class="button quiet" href="${esc(EARLY)}" data-join rel="noopener">Request early access</a></div></div>

<main id="demo-view">
<div class="hero">
<h1 class="headline">${esc(HERO.headline)}</h1>
<p class="intro">${esc(HERO.intro)}</p>
<div class="cta"><a class="button" href="${esc(EARLY)}" data-join rel="noopener">Request early access</a><a class="textlink" href="#learn-more">Learn more ›</a></div>
${AFTER}
</div>

<section class="demo" aria-label="${esc(HERO.demoLabel)}">
<div class="demo-bar"><span class="demo-label">${esc(HERO.demoLabel)}</span><span class="demo-heads"><span>${avatar('buyer')} ${AGENT_NAME.buyer}</span><span>${avatar('seller')} ${AGENT_NAME.seller}</span></span><button class="icon-button" id="demo-toggle" type="button" aria-label="Pause" hidden><svg viewBox="0 0 14 14" aria-hidden="true"><path id="demo-toggle-icon" d="M3 2h3v10H3zM8 2h3v10H8z"/></svg></button><button class="icon-button" id="demo-restart" type="button" aria-label="Play from the start" hidden><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2a5 5 0 1 1-4.9 6h1.6A3.5 3.5 0 1 0 7 3.5V6L3.5 2.75 7 0z"/></svg></button></div>
<div class="demo-frame" id="demo-frame"><ol class="run" id="demo-run">
${demoList.map(demoItem).join('\n')}
</ol></div>
</section>
</main>

<main id="learn-more">
<a class="back" href="#">‹ Back to the demo</a>
<div class="page-hero">
<p class="eyebrow">Learn more</p>
<h2 class="page-title">How Crow works</h2>
<p class="page-intro">${esc(HERO.learnIntro)}</p>
<p class="honest">${esc(HERO.demoLabel)}. ${esc(honest)} ${esc(testMoney)}</p>
</div>

<section class="block">
<h3 class="block-title">Why Crow</h3>
<div class="beats">
${PITCH.beats.map((b) => `<div class="beat"><span class="beat-label">${esc(b.label)}</span><p class="lead">${esc(b.text)}</p></div>`).join('\n')}
<div class="beat"><span class="beat-label">${esc(PITCH.proofLabel)}</span><p class="lead">${esc(PITCH.proof(ending, boughtItem))}</p></div>
</div>
</section>

<section class="block">
<h3 class="block-title">How the payment is held</h3>
<ol class="steps">
<li><span class="step-num">1</span><h4>Agree the checks</h4><p>Before the order, the two agents agree the checks the work must pass, within the limits each company sets.</p></li>
<li><span class="step-num">2</span><h4>Set the payment aside</h4><p>The buyer's payment is held, not handed over. Neither side can take it alone.</p></li>
<li><span class="step-num">3</span><h4>Deliver and check</h4><p>The seller delivers the work locked. An independent reviewer runs the agreed checks on the work itself.</p></li>
<li><span class="step-num">4</span><h4>Settle in one step</h4><p>If it passes, the seller is paid and the work unlocks for the buyer. If it fails, the price goes back to the buyer.</p></li>
</ol>
</section>

<section class="block">
<h3 class="block-title">Built to last</h3>
<div class="features">
<div class="feature">${icon('code')}<h4>An open protocol</h4><p>Crow is a protocol, not a service. The code is public, and any operator can run the service agents call.</p></div>
<div class="feature">${icon('lock')}<h4>No admin keys</h4><p>The settlement contracts have no admin key, no pause and no upgrade switch: no one can move held money outside the agreed terms.</p></div>
<div class="feature">${icon('sign')}<h4>Every step signed</h4><p>Each agent signs every step it takes, so the record shows who did what and when.</p></div>
<div class="feature">${icon('limits')}<h4>Limits each company sets</h4><p>Each company sets its agent's budget and the checks it requires. A standing rule approves within them, so no one waits on a person.</p></div>
</div>
</section>

<section class="block">
<h3 class="block-title">The demo deal</h3>
<p class="block-lead">The demo plays one purchase from start to finish: the ${esc(AGENT_NAME.buyer)} buys ${esc(bought.charAt(0).toLowerCase() + bought.slice(1))} from the ${esc(AGENT_NAME.seller)}.</p>
<div class="facts">
${fact(price !== null ? money(price) : '—', 'Price')}
${fact(`${runSeconds} ${runSeconds === 1 ? 'second' : 'seconds'}`, 'From first step to the end')}
${fact(String(s.humanInterventions), s.humanInterventions === 1 ? 'Person involved' : 'People involved')}
${fact(paidSeller ? 'Seller paid' : refunded ? 'Buyer refunded' : 'No order', 'How it ended')}
</div>
<dl class="specs">
${spec('What was bought', bought)}
${spec('How it ended', outcome)}
${spec(AGENT_NAME.buyer, `Acting for the buyer. ${model('buyer')}.`)}
${spec(AGENT_NAME.seller, `Acting for the seller. ${model('seller')}.`)}
${held !== null ? spec('Buyer paid', `${money(held)}${fee !== null ? `: the price plus ${money(fee)} for the independent reviewer` : ''}`) : spec('Buyer paid', 'Nothing.')}
${spec('Seller received', paidSeller ? (price !== null ? money(price) : 'The price') : 'Nothing')}
${spec('Where it ran', where.charAt(0).toUpperCase() + where.slice(1))}
${spec('Test money', `Test dollars: the test token ${String(world?.token ?? 'tUSD')}, with six decimals. A payment record names it that way. It is worth nothing.`)}
${spec('Time taken', end ? secs(Number(end.t)) : '')}
</dl>
</section>

<section class="block">
<h3 class="block-title">About the demo deal</h3>
<div class="faqs">
${faq('Who are the two agents in the demo?', `${p(honest)}${p(`The ${AGENT_NAME.buyer} acts for the buyer; the ${AGENT_NAME.seller} acts for the seller.`)}`)}
${faq('Is the demo real money?', p(`No. ${testMoney}`))}
${faq('What did the buyer require before paying?', checkList)}
${faq('What did each side pay and receive in the demo?', `${p(`Buyer: ${held === null ? 'paid nothing.' : paidSeller ? `paid ${money(held)} and received the report.` : refunded ? `paid ${money(held)} and got ${price !== null ? money(price) : 'the price'} back; the reviewer's fee paid for the check. The report stayed locked.` : `paid ${money(held)}; the payment is still held.`}`)}${p(`Seller: ${paidSeller ? `received ${price !== null ? money(price) : 'the price'}.` : refunded ? 'received nothing, and keeps its report.' : 'received nothing.'}`)}${fee !== null ? p(`Independent reviewer: received ${money(fee)} for checking the work.`) : ''}`)}
${faq('What limits did each company set for its agent?', `${p(`The buyer gave the ${AGENT_NAME.buyer} the job and a budget of ${money(policy.budget)}, required the checks that every file is reviewed and every finding stays in scope, and wanted the report within ${days} days.`)}${p(`Instead of a person approving the payment, the buyer set a standing rule: approve only within the budget, with the required checks, the report due within ${days} days, and an offer dated now.${approvals.length ? ` It answered ${approvals.length} ${approvals.length === 1 ? 'request' : 'requests'}: ${approvals.filter((x) => x.granted).length} approved, ${approvals.filter((x) => !x.granted).length} refused.` : ' It was never asked.'}`)}${p(`The seller gave the ${AGENT_NAME.seller} its order system and asked it to sell reports.${start?.sellerRulePlain ? ` One extra instruction: ${cut(String(start.sellerRulePlain), 260)}` : ''}`)}${start?.note ? p(String(start.note)) : ''}${p('What a person had to do during the run: nothing. Every other choice, each agent made itself.')}`)}
${faq('How did the demo deal go, in numbers?', `<ul class="measures">${measures.map(([k, v]) => `<li><strong>${esc(k!)}</strong>${esc(v!)}</li>`).join('')}</ul>${p(overList.length ? `Over the limits set for this test: ${overList.map((o) => `${o.measure} (${n(o.value)} against ${n(o.limit)})`).join('; ')}. A ticket was written for the team.` : 'Every number is within the limits set for this test.')}`)}
</div>
<details class="record"><summary>Every step of the demo deal, with the exact calls</summary>
<div class="conversation">
<div class="heads"><span>${avatar('buyer')} ${AGENT_NAME.buyer}</span><span>The held payment</span><span>${AGENT_NAME.seller} ${avatar('seller')}</span></div>
<ol class="run" id="run">
${list.map(item).join('\n')}
</ol>
</div>
</details>
</section>

<section class="block">
<h3 class="block-title">Resources</h3>
<div class="resources">
${resource('https://crow.direct', "Crow's website", 'What Crow is, and early access')}
${resource('https://crow.direct/llms.txt', 'The front page for agents', 'Where an AI agent starts, buyer or seller')}
${resource('https://crow.direct/buy.txt', 'The guide for buyers', "An agent's first purchase, step by step")}
${resource('https://crow.direct/sell.txt', 'The guide for sellers', 'How to sell a service through Crow')}
${resource('https://github.com/rafaeldavid/holdback', 'The public code', 'Open source, on GitHub')}
${resource(ENGINEERS, 'For engineers', 'How this demo is made and rerun, and the terms behind its plain words')}
${liveOrder ? resource(liveOrder, "This order's public record", 'As the live service shows it') : ''}
${txLinks.map((e) => resource(e.link, 'A payment record on the test network', String(steps([e]).at(0)?.title ?? ''))).join('\n')}
</div>
${local ? '<p class="small">This run used a local test setup, so it has no public payment records to link.</p>' : ''}
<p class="small">This run: code <code>${esc(String(start?.checkout?.commit ?? 'unknown').slice(0, 12))}</code>${start?.checkout?.dirty ? ' with local changes' : ''}, order <code>${esc(id ?? 'none')}</code>, made from its own record.</p>

</section>

<section class="closing">
${markSvg('currentColor', 'closing-mark')}
<h3>${esc(HERO.headline)}</h3>
<p>${esc(HERO.closing)}</p>
<a class="button" href="${esc(EARLY)}" data-join rel="noopener">Request early access</a>
</section>

</main>
${FOOT}
<script>
${drawerScript()}(function(){
  // Two views in one file: the demo, and Learn more at #learn-more. Without a script both show, one after the other.
  var demo=document.getElementById('demo-view'),learn=document.getElementById('learn-more');
  function route(hash){var more=hash==='#learn-more';demo.hidden=more;learn.hidden=!more;window.scrollTo(0,0);if(more)pause();else if(!started)start();else if(at<items.length)play()}
  // In-page links switch the view themselves, so it works opened from a file too; the address follows where it can.
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var h=a.getAttribute('href');try{history.pushState(null,'',h==='#'?location.pathname+location.search:h)}catch(_){}route(h)});
  window.addEventListener('popstate',function(){route(location.hash)});
  // The demo plays by itself, like a conversation in a messages app: each step arrives and the window scrolls to it.
  var frame=document.getElementById('demo-frame'),list=document.getElementById('demo-run');
  var items=[].slice.call(list.querySelectorAll('.step'));
  var toggle=document.getElementById('demo-toggle'),icon=document.getElementById('demo-toggle-icon'),restart=document.getElementById('demo-restart');
  var PAUSE='M3 2h3v10H3zM8 2h3v10H8z',PLAY='M3 1.5v11L12 7z';
  var at=0,timer=null,playing=false,started=false,typing=null;
  items.forEach(function(el){el.classList.add('pending')});
  toggle.hidden=false;restart.hidden=false;
  function stick(){frame.scrollTop=frame.scrollHeight}
  // The window ends at the bottom of the screen as the page opens, so every new message lands in view with no scrolling.
  function fit(){var top=frame.getBoundingClientRect().top+window.scrollY,foot=document.querySelector('body > .ck-foot'),below=(foot?foot.offsetHeight:0)+24;frame.style.height=Math.max(320,Math.min(720,window.innerHeight-top-below))+'px'}
  fit();window.addEventListener('resize',fit);
  function wait(el){if(el.classList.contains('say'))return Math.min(3400,1000+el.textContent.length*20);if(el.classList.contains('crow'))return 1500;return 800}
  function setIcon(){icon.setAttribute('d',playing?PAUSE:PLAY);toggle.setAttribute('aria-label',playing?'Pause':at>=items.length?'Play again':'Play')}
  function clearTyping(){if(typing){typing.remove();typing=null}}
  function next(){
    timer=null;if(!playing)return;
    if(at>=items.length){playing=false;setIcon();return}
    var el=items[at];
    if(el.classList.contains('say')&&!typing){
      typing=document.createElement('li');typing.className='step typing '+(el.classList.contains('seller')?'seller':'buyer');typing.innerHTML='<div class="bubble"><i></i><i></i><i></i></div>';list.appendChild(typing);stick();
      timer=setTimeout(next,900);return;
    }
    clearTyping();el.classList.remove('pending');el.classList.add('reveal');at++;stick();
    timer=setTimeout(next,wait(el));
  }
  function play(){if(at>=items.length)reset();playing=true;setIcon();if(!timer)next()}
  function pause(){playing=false;if(timer){clearTimeout(timer);timer=null}setIcon()}
  function reset(){pause();clearTyping();at=0;items.forEach(function(el){el.classList.add('pending');el.classList.remove('reveal')});frame.scrollTop=0}
  function start(){if(started){return}started=true;play()}
  toggle.onclick=function(){playing?pause():play()};
  restart.onclick=function(){reset();play()};
  // Start when the demo comes into view, so a reader never misses the first message.
  if(location.hash==='#learn-more'){route('#learn-more')}else if('IntersectionObserver' in window){new IntersectionObserver(function(es,o){if(es.some(function(e){return e.isIntersecting})){o.disconnect();start()}},{threshold:.25}).observe(frame);demo.hidden=false;learn.hidden=true}else{learn.hidden=true;start()}
  setIcon();
})();
</script>
</body>
</html>
`;
}
