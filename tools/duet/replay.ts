// The replay page (T-391): one self-contained HTML file, generated from the run's record and nothing else, that a
// partner can read with no other page or person. It is written as a seasoned buyer would explain a purchase to a peer:
// what was bought and for how much, the agreed checks, what happened step by step, how it ended, who paid and received
// what, how long it took, and what a person had to do. Protocol names appear only in the "For engineers" section and
// behind "Exact call" disclosures. Every string from the record is escaped: an agent's words, or anything it quoted,
// is shown as text, never as markup. The only network use is a link the reader clicks. A small inline script steps
// through the run; without it, every step shows.
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
/** Base units of a 6-decimal test token, as test tokens with two decimals. */
const tokens = (amount: unknown) => {
  const a = typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : typeof amount === 'bigint' ? amount : null;
  if (a === null) return '';
  const whole = a / 1_000_000n, cents = (a % 1_000_000n) / 10_000n;
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')} test tokens`;
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
        ? { lane: 'buyer', t: e.t, kind: 'note', title: "The company's standing rule approved the payment", detail: `Within the budget of ${tokens(e.policy?.budget)}, with the checks the company requires, and the report due within ${Math.round(Number(e.policy?.latestDeliverySec ?? 0) / 86_400)} days.` }
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
        'hold.funded': () => step('money', `The buyer's payment is held: ${tokens(held)}`, `${price !== null ? `${tokens(price)} for the work` : 'The price'}${fee !== null ? `, ${tokens(fee)} for the reviewer` : ''}. Neither side can take it alone.`),
        'delivery.submitted': () => step('chain', 'The seller delivered the report, locked'),
        'key.released': () => step('chain', role(e.recipient) === 'buyer' ? 'The report unlocks for the buyer' : 'The reviewer can now open the report to check it'),
        'judgment.decided': () => step('chain', e.outcome === 'accept' ? 'The work passed the agreed checks' : e.outcome === 'reject' ? 'The work failed a required check' : 'The reviewer decided'),
        'settlement.released': () => step('money', 'The seller is paid', `${price !== null ? tokens(price) : 'The price'} to the seller. The report unlocks for the buyer in the same step.`),
        'settlement.refunded': () => step('money', 'The buyer is refunded', `${price !== null ? tokens(price) : 'The price'} back to the buyer. The report stays locked.`),
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
};
const icon = (name: string) => `<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ICON['act']}</svg>`;

/** How the replayed run ended, as the proof beat tells it. */
export type Ending = 'paid' | 'refunded' | 'declined' | 'held' | 'stopped';

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
};
/** Where "Request early access" goes: the sign-up form on Crow's site. */
export const EARLY_ACCESS = 'https://crow.direct/#join-form';

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
  const ending: Ending = paidSeller ? 'paid' : refunded ? 'refunded' : held !== null ? 'held' : events.some((e) => e.kind === 'signer.stop') && (events.find((e) => e.kind === 'agent.end' && e.role === 'buyer') as J)?.status === 'finished' ? 'declined' : 'stopped';
  const boughtItem = String(start?.item ?? (scope?.files?.length ? 'a software security audit' : 'a piece of work'));
  const bought = `A security review of ${scope?.files?.length ?? 'several'} smart-contract files (${n(Number(scope?.lines ?? 0))} lines), written as a report`;
  const outcome = paidSeller ? 'The work passed. The seller was paid and the buyer received the report.' : refunded ? 'The work failed a required check. The buyer got the price back and the report stayed locked.' : 'No order was placed. Nothing was signed and nothing was paid.';
  const ok = s.decisionRight;
  const policy = start?.policy ?? {};
  const days = Math.round(Number(policy.latestDeliverySec ?? 0) / 86_400);
  const approvals = s.ownerApprovals;

  const row = (label: string, value: string) => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;
  const avatar = (r: 'buyer' | 'seller') => `<span class="avatar ${r}" aria-hidden="true">${r === 'buyer' ? 'B' : 'S'}</span>`;
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
    ? `<div class="group">${checks.map((c) => `<div class="row"><span class="value">${esc(CHECKS[c.id] ?? `The check named “${c.id}”.`)}${c.required ? '' : ' (advisory: it does not decide on its own)'}</span></div>`).join('')}</div>`
    : '<p class="footnote">No offer reached the buyer, so no checks were agreed.</p>';

  const tile = (title: string, value: string, note: string, tone = '') => `<div class="tile ${tone}"><span class="tile-title">${esc(title)}</span><span class="tile-value">${esc(value)}</span><span class="tile-note">${esc(note)}</span></div>`;
  const tok = (r: 'buyer' | 'seller') => s.tokens[r].input + s.tokens[r].output;
  const forbidden = s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove;
  const tiles = [
    tile('The right outcome', ok ? 'Yes' : 'No', ok ? outcome : `Not what this test expected: ${s.why}.`, ok ? 'good' : 'bad'),
    tile('Time from the work passing to the seller being paid', s.workPassesToPaidSec === null ? '—' : `${s.workPassesToPaidSec} s`, s.workPassesToPaidSec === null ? 'Nobody was paid in this run.' : 'Counted on the order record, in whole seconds.'),
    tile('People involved during the run', String(s.humanInterventions), approvals.length ? `The buyer set one standing rule in advance; it answered ${approvals.length} approval ${approvals.length === 1 ? 'request' : 'requests'}.` : 'Nobody acted during the run.'),
    tile('Tokens used', n(s.tokens.deal), `The ${AGENT_NAME.buyer} used ${n(tok('buyer'))}: ${n(s.tokens.buyer.guides)} to read Crow's guides and keep them in mind, ${n(s.tokens.buyer.work)} for the purchase itself. The ${AGENT_NAME.seller} used ${n(tok('seller'))}: ${n(s.tokens.seller.guides)} for the guides, ${n(s.tokens.seller.work)} for the sale. The two guides come to about ${n(s.guides.tokens)} tokens; an agent pays for them again on every step once it has read them.${scripted ? ' Scripted stand-ins count text length divided by four.' : ''}${s.costMicroUsd.buyer !== null || s.costMicroUsd.seller !== null ? ` At list prices, about ${usd((s.costMicroUsd.buyer ?? 0) + (s.costMicroUsd.seller ?? 0))}.` : ''}`),
    tile('Steps the agents took', n(s.calls.buyer.turns + s.calls.seller.turns), `${n(s.calls.buyer.toolCalls + s.calls.seller.toolCalls)} actions; ${n(s.calls.buyer.refused + s.calls.seller.refused)} were stopped by the agents' own tools.`),
    tile('Times an agent got stuck', String(s.stalls.length), s.stalls.length ? s.stalls.map((x) => `The ${AGENT_NAME[x.role as 'buyer' | 'seller'] ?? x.role}: ${x.reason}.`).join(' ') : 'Neither agent repeated a failing step or ran out of allowance.', s.stalls.length ? 'bad' : ''),
    tile('Agreed to terms the buyer ruled out', forbidden ? 'Yes' : 'No', forbidden ? (s.forbiddenTerms.funded ? `The ${AGENT_NAME.buyer} paid for terms the buyer ruled out.` : `The ${AGENT_NAME.buyer} asked to approve terms the buyer ruled out; the buyer's standing rule refused.`) : `The ${AGENT_NAME.buyer} approved only terms the buyer allows.`, forbidden ? 'bad' : ''),
  ].join('');
  const overList = extras.over ?? [];

  const id = s.outcome.commitmentId;
  const liveOrder = !local && id && Array.isArray(world?.operators) && typeof world.operators[0] === 'string' && /^https:\/\/[^\s"']+$/.test(world.operators[0]) && /^0x[0-9a-f]{64}$/.test(id) ? `${world.operators[0]}/v1/commitments/${id}` : null;
  const txLinks = chain.filter((e) => typeof e.link === 'string' && /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]{64}$/.test(e.link));
  const link = (href: string, label: string, note: string) => `<a class="row linkrow" href="${esc(href)}" rel="noopener" target="_blank">${icon('link')}<span class="value"><span>${esc(label)}</span><span class="sub">${esc(note)}</span></span></a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PITCH.title)} · ${esc(PITCH.descriptor)}</title>
<style>
:root{--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--canvas:#f5f5f7;--surface:#ffffff;--fill:#e9e9eb;--line:rgba(60,60,67,.12);--ink:#1d1d1f;--ink2:#6e6e73;--ink3:#8e8e93;--accent:#007aff;--accent-ink:#ffffff;--green:#248a3d;--red:#d70015;--wash-green:#e8f6ec;--r-sm:6px;--r-md:8px;--r-lg:10px;--r-win:12px;--arrive:cubic-bezier(.25,.8,.25,1);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--canvas:#000000;--surface:#1c1c1e;--fill:#2c2c2e;--line:rgba(84,84,88,.6);--ink:#f5f5f7;--ink2:#98989d;--ink3:#7c7c80;--accent:#0a84ff;--green:#30d158;--red:#ff453a;--wash-green:#132a1a}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.45 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.toolbar{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line)}
.toolbar-inner{max-width:880px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:16px}
.app{font-weight:600;font-size:15px;color:var(--ink);text-decoration:none}.app small{display:block;font-weight:400;font-size:12px;color:var(--ink2)}
.spacer{flex:1}
.navlink{font-size:14px;text-decoration:none}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 18px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:inherit;font-size:15px;font-weight:600;text-decoration:none;border:0;cursor:pointer}
.button.small{min-height:32px;padding:0 14px;font-size:14px}
.button.plain{background:transparent;color:var(--accent);padding:0 6px}
main{max-width:880px;margin:0 auto;padding:32px 16px 64px}
.hero{text-align:center;max-width:680px;margin:0 auto}
.headline{font-family:var(--display);font-size:44px;line-height:1.06;font-weight:700;letter-spacing:-.025em;margin:0}
.intro{font-size:18px;line-height:1.45;color:var(--ink2);margin:12px auto 0}
.cta{display:flex;gap:12px;justify-content:center;align-items:center;margin-top:18px}
.demo{margin-top:28px;background:var(--surface);border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06),0 12px 32px rgba(0,0,0,.06)}
.demo-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
.demo-label{font-size:13px;font-weight:600;color:var(--ink2)}
.demo-heads{flex:1;display:flex;justify-content:center;gap:18px;font-size:12px;color:var(--ink2)}
.demo-heads span{display:flex;align-items:center;gap:6px}
.icon-button{width:32px;height:32px;border-radius:999px;border:0;background:var(--fill);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.icon-button svg{width:14px;height:14px;fill:currentColor}
.icon-button[hidden]{display:none}
.demo-frame{height:min(68vh,600px);overflow-y:auto;padding:16px 12px 24px;scroll-behavior:smooth}
.after{text-align:center;font-size:14px;color:var(--ink2);margin:16px 0 0}
.section{font-size:13px;color:var(--ink2);text-transform:uppercase;letter-spacing:.02em;margin:30px 12px 8px}
.page-title{font-family:var(--display);font-size:34px;line-height:1.1;font-weight:700;letter-spacing:-.02em;margin:8px 0 0}
.back{font-size:14px;text-decoration:none}
.engine{margin:10px 0 0;font-size:13px;font-weight:600;color:var(--ink2)}
.lead{margin:14px 0 0;font-size:16px;max-width:680px}
.beat{margin-top:18px}.beat .lead{margin-top:4px}.beat-label{font-size:13px;font-weight:600;color:var(--ink2)}
.group{background:var(--surface);border-radius:var(--r-win);overflow:hidden}
.row{display:flex;align-items:center;gap:12px;padding:11px 16px;min-height:44px;color:inherit;text-decoration:none}
.row+.row{border-top:1px solid var(--line);margin-left:16px;padding-left:0}
.row .label{flex:0 0 150px;color:var(--ink2)}
.row .value{flex:1;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.linkrow .value>span:first-child,.linkrow .glyph{color:var(--accent)}
.footnote{font-size:13px;color:var(--ink2);margin:8px 16px 0}
.callout{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border-radius:var(--r-win);padding:12px 16px;margin:14px 0 0;font-size:14px}
.callout p{margin:0}.callout .glyph{color:var(--accent);margin-top:2px}
.avatar{width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff}
.avatar.buyer{background:#8e8e93}.avatar.seller{background:var(--accent)}
.conversation{background:var(--surface);border-radius:var(--r-win);padding:16px 12px 20px}
.heads{display:flex;justify-content:space-between;padding:0 4px 12px;border-bottom:1px solid var(--line);margin-bottom:12px;font-size:13px;color:var(--ink2)}
.heads span{display:flex;align-items:center;gap:8px}
ol.run{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.step{display:flex;flex-direction:column;max-width:72%}
.step.buyer{align-self:flex-start;align-items:flex-start}.step.seller{align-self:flex-end;align-items:flex-end}
.step.crow{align-self:center;max-width:88%;margin:6px 0}
.step.pending{display:none}
.step.reveal{animation:arrive .8s var(--arrive) both}
@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.bubble{border-radius:18px;padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}.bubble p{margin:0}
.buyer .bubble{background:var(--fill);color:var(--ink);border-bottom-left-radius:6px}
.seller .bubble{background:var(--accent);color:var(--accent-ink);border-bottom-right-radius:6px}
.typing .bubble{display:flex;gap:4px;padding:12px 14px}
.typing .bubble i{width:7px;height:7px;border-radius:999px;background:currentColor;opacity:.4;animation:blink 1.2s infinite}
.typing .bubble i:nth-child(2){animation-delay:.2s}.typing .bubble i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:.8}}
.meta{font-size:11px;color:var(--ink3);margin:3px 8px 0}
.action{display:flex;gap:8px;align-items:flex-start;color:var(--ink2);font-size:13px;padding:2px 8px}
.seller .action{flex-direction:row-reverse;text-align:right}
.action .title{display:block;color:var(--ink2)}
.sub{display:block;font-size:12px;color:var(--ink3);overflow-wrap:anywhere;white-space:pre-wrap}
.note .action,.end .action{background:var(--canvas);border-radius:var(--r-lg);padding:8px 12px}
.note .action .title,.end .action .title{color:var(--ink);font-weight:600}
details{margin-top:4px;font-size:12px;color:var(--ink3)}details summary{cursor:pointer;list-style:none}details summary::-webkit-details-marker{display:none}details summary::before{content:"› "}details[open] summary::before{content:"⌄ "}
pre{font-family:var(--mono);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--canvas);border-radius:var(--r-sm);padding:8px;margin:4px 0 0;text-align:left;color:var(--ink2)}
.glyph{width:16px;height:16px;flex:0 0 16px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.capsule{display:flex;align-items:center;gap:10px;background:var(--canvas);border-radius:999px;padding:7px 14px;font-size:13px;color:var(--ink)}
.capsule strong{font-weight:600}.capsule .time{font-size:11px;color:var(--ink3);white-space:nowrap}
.money .capsule{background:var(--wash-green);border-radius:var(--r-win);padding:10px 16px}.money .capsule .glyph{color:var(--green)}
.capsule a{color:var(--accent);text-decoration:none}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tile{background:var(--surface);border-radius:var(--r-win);padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.tile:first-child{grid-column:1/-1}
.tile-title{font-size:13px;font-weight:600;color:var(--ink2)}.tile-value{font-size:28px;font-weight:700;letter-spacing:-.01em}.tile-note{font-size:13px;color:var(--ink2)}
.tile.good .tile-value{color:var(--green)}.tile.bad .tile-value{color:var(--red)}
.engineers{margin-top:30px}.engineers>summary{font-size:13px;color:var(--ink2);text-transform:uppercase;letter-spacing:.02em;margin:0 12px 8px}
.engineers .group{padding:12px 16px;font-size:13px;color:var(--ink2)}.engineers .group p{margin:0 0 8px}.engineers code{font-family:var(--mono);font-size:12px}
footer{font-size:12px;color:var(--ink3);margin:28px 12px 0;max-width:680px}
@media (max-width:600px){.step{max-width:88%}.row .label{flex-basis:110px}.app small{display:none}.headline{font-size:36px}.intro{font-size:17px}.demo-heads{display:none}.navlink{display:none}}
@media (prefers-reduced-motion:reduce){.demo-frame{scroll-behavior:auto}.step.reveal{animation:none}.typing .bubble i{animation:none}}
</style>
</head>
<body>
<div class="toolbar"><div class="toolbar-inner"><a class="app" href="#">${esc(PITCH.title)}<small>${esc(PITCH.descriptor)}</small></a><div class="spacer"></div><a class="navlink" href="#learn-more">Learn more</a><a class="button small" href="${esc(EARLY)}" rel="noopener">Request early access</a></div></div>

<main id="demo-view">
<div class="hero">
<h1 class="headline">${esc(HERO.headline)}</h1>
<p class="intro">${esc(HERO.intro)}</p>
<div class="cta"><a class="button" href="${esc(EARLY)}" rel="noopener">Request early access</a><a class="button plain" href="#learn-more">Learn more ›</a></div>
</div>

<section class="demo" aria-label="${esc(HERO.demoLabel)}">
<div class="demo-bar"><span class="demo-label">${esc(HERO.demoLabel)}</span><span class="demo-heads"><span>${avatar('buyer')} ${AGENT_NAME.buyer}</span><span>${avatar('seller')} ${AGENT_NAME.seller}</span></span><button class="icon-button" id="demo-toggle" type="button" aria-label="Pause" hidden><svg viewBox="0 0 14 14" aria-hidden="true"><path id="demo-toggle-icon" d="M3 2h3v10H3zM8 2h3v10H8z"/></svg></button><button class="icon-button" id="demo-restart" type="button" aria-label="Play from the start" hidden><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2a5 5 0 1 1-4.9 6h1.6A3.5 3.5 0 1 0 7 3.5V6L3.5 2.75 7 0z"/></svg></button></div>
<div class="demo-frame" id="demo-frame"><ol class="run" id="demo-run">
${demoList.map(demoItem).join('\n')}
</ol></div>
</section>
<p class="after">What was checked, what each side paid, and the full record: <a href="#learn-more">Learn more ›</a></p>
</main>

<main id="learn-more">
<a class="back" href="#">‹ Back to the demo</a>
<h2 class="page-title">Learn more</h2>
<p class="engine">${local ? 'This demo is a test run on a local test setup, with test money. No real money moved, and there are no public records of it.' : `This demo is a test run on ${esc(where)}. No real money moved.`}</p>

<div class="section">About</div>
${PITCH.beats.map((b) => `<div class="beat"><span class="beat-label">${esc(b.label)}</span><p class="lead">${esc(b.text)}</p></div>`).join('\n')}
<div class="beat"><span class="beat-label">${esc(PITCH.proofLabel)}</span><p class="lead">${esc(PITCH.proof(ending, boughtItem))}</p></div>

<div class="section">How the payment is held</div>
<div class="group">
${row('While the work is done', "The buyer's payment is held, not handed over. Neither side can take it alone, and no one in between can move it another way.")}
${row('When the work passes', 'The payment goes to the seller, and the work unlocks for the buyer in the same step.')}
${row('When it fails', 'The price goes back to the buyer, and the work stays locked.')}
${row('Who checks', 'An independent reviewer runs the checks both sides agreed to before the order, on the delivered work itself.')}
</div>
<p class="footnote">${scripted ? 'In this demo both agents are scripted stand-ins that follow a fixed list of steps: it shows how the pieces fit, not what an AI model would do.' : `The ${AGENT_NAME.buyer} is ${esc(model('buyer'))} and the ${AGENT_NAME.seller} is ${esc(model('seller'))}: real AI models${s.models.buyer.vendor !== s.models.seller.vendor ? ' from two different companies' : ''}, each using only its own tools. They never talked to each other directly.`}</p>

<div class="section">The purchase</div>
<div class="group">
${row('What was bought', bought)}
${row('Price', price !== null ? tokens(price) : 'No price agreed')}
${held !== null ? row('Buyer paid', `${tokens(held)}${fee !== null ? `: the price plus ${tokens(fee)} for the independent reviewer` : ''}`) : ''}
${row(AGENT_NAME.buyer, `Acting for the buyer. ${model('buyer')}.`)}
${row(AGENT_NAME.seller, `Acting for the seller. ${model('seller')}.`)}
${row('How it ended', outcome)}
${row('Time taken', end ? secs(Number(end.t)) : '')}
${row('Where it ran', where.charAt(0).toUpperCase() + where.slice(1))}
</div>

<div class="section">What each side paid and received</div>
<div class="group">
${row('Buyer', held === null ? 'Paid nothing.' : paidSeller ? `Paid ${tokens(held)} and received the report.` : refunded ? `Paid ${tokens(held)} and got ${price !== null ? tokens(price) : 'the price'} back; the reviewer's fee paid for the check. The report stayed locked.` : `Paid ${tokens(held)}; the payment is still held.`)}
${row('Seller', paidSeller ? `Received ${price !== null ? tokens(price) : 'the price'}.` : refunded ? 'Received nothing, and keeps its report.' : 'Received nothing.')}
${fee !== null ? row('Independent reviewer', `Received ${tokens(fee)} for checking the work.`) : ''}
</div>

<div class="section">The agreed checks</div>
${checkList}

<div class="section">Set in advance by the two companies</div>
<div class="group">
${row("The buyer", `Gave the ${AGENT_NAME.buyer} the job and a budget of ${tokens(policy.budget)}, required the checks that every file is reviewed and every finding stays in scope, and wanted the report within ${days} days.`)}
${row('Standing approval rule', `Instead of a person approving the payment, the buyer set a rule: approve only within the budget, with the required checks, the report due within ${days} days, and an offer dated now.${approvals.length ? ` It answered ${approvals.length} ${approvals.length === 1 ? 'request' : 'requests'}: ${approvals.filter((x) => x.granted).length} approved, ${approvals.filter((x) => !x.granted).length} refused.` : ' It was never asked.'}`)}
${row("The seller", `Gave the ${AGENT_NAME.seller} its order system and asked it to sell reports.${start?.sellerRulePlain ? ` One extra instruction: ${cut(String(start.sellerRulePlain), 260)}` : ''}`)}
</div>
${start?.note ? `<div class="callout">${icon('note')}<p>${esc(String(start.note))}</p></div>` : ''}
<p class="footnote">What a person had to do during the run: nothing. Every other choice, each agent made itself.</p>

<div class="section">The full record, step by step</div>
<div class="conversation">
<div class="heads"><span>${avatar('buyer')} ${AGENT_NAME.buyer}</span><span>The held payment</span><span>${AGENT_NAME.seller} ${avatar('seller')}</span></div>
<ol class="run" id="run">
${list.map(item).join('\n')}
</ol>
</div>

<div class="section">How it went, in numbers</div>
<div class="tiles">${tiles}</div>
<p class="footnote">${overList.length ? `Over the limits set for this test: ${esc(overList.map((o) => `${o.measure} (${n(o.value)} against ${n(o.limit)})`).join('; '))}. A ticket was written for the team.` : 'Every number is within the limits set for this test.'}</p>

<div class="section">Sources</div>
<div class="group">
${link('https://crow.direct', "Crow's website", 'What Crow is, and early access')}
${link('https://crow.direct/llms.txt', 'The front page an AI agent reads first', 'Where to start, for a buyer or a seller')}
${link('https://crow.direct/buy.txt', 'The guide for buyers', "An agent's first purchase, step by step")}
${link('https://crow.direct/sell.txt', 'The guide for sellers', 'How to sell a service through Crow')}
${link('https://github.com/rafaeldavid/holdback', 'The public code', 'Open source, on GitHub')}
${liveOrder ? link(liveOrder, "This order's public record", 'As the live service shows it') : ''}
${txLinks.map((e) => link(e.link, 'A payment record on the test network', String(steps([e]).at(0)?.title ?? ''))).join('\n')}
</div>
${local ? '<p class="footnote">This run used a local test setup, so it has no public payment records to link.</p>' : ''}

<details class="engineers" id="engineers"><summary>For engineers</summary><div class="group">
<p>Engine: ${esc(s.engine)}. Order (commitment) ID: <code>${esc(id ?? 'none')}</code>. Final state: <code>${esc(s.outcome.state)}</code>.</p>
<p>Agents: buyer <code>${esc(s.models.buyer.model)}</code> (${esc(s.models.buyer.vendor)}), seller <code>${esc(s.models.seller.model)}</code> (${esc(s.models.seller.vendor)}). Each is a tool-use loop over its vendor's API with fenced tools: GET to an allowlist, a fixed list of the repository's client commands (buy-with-signer, seller-adapter, check-delivery, seal, deal-record), and files in its own folder. Keys stay in files and environments the agents cannot read.</p>
<p>Plain words used above: the held payment is the escrow hold; the independent reviewer is the adjudicator; the agreed checks are the terms' deterministic checks; signed means an EIP-712 signature; the report unlocking is the content key's release with the payment; a payment record is a settlement transaction. The seller's tool is examples/seller-adapter.ts and the buyer's is examples/buy-with-signer.ts; the standing approval rule answers the signer's approval stop.</p>
<p>Docs served to the agents: ${esc((world?.docsChanges ?? []).join(' ') || 'as published')}</p>
<p>Code: <code>${esc(String(start?.checkout?.commit ?? 'unknown').slice(0, 12))}</code>${start?.checkout?.dirty ? ' with local changes' : ''}. The page comes from record.jsonl beside it; summary.json holds the measures${extras.ticket ? ', and ticket.md the items over the limits' : ''}.</p>
</div></details>

<footer>Made from this run's own record and nothing else. The agents' words appear as they wrote them; anything they quoted is shown as plain text. No key appears here: the agents never held one, and the record replaces any it meets with [secret].</footer>
</main>
<script>
(function(){
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
  function fit(){var top=frame.getBoundingClientRect().top+window.scrollY;frame.style.height=Math.max(320,Math.min(720,window.innerHeight-top-20))+'px'}
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
