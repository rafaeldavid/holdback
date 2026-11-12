// The replay page (T-391): one self-contained HTML file, generated from the run's record and nothing else. The buyer
// on the left, the seller on the right, Crow's rails and the chain in the middle, step by step in the order things
// happened, with each agent's own words, each tool call in plain language, the money's movement, and the seven
// measures at the end. Every string from the record is escaped: an agent's words, a page it read or a report it
// quoted are shown as text, never as markup. A small inline script steps through the run; without it, every step shows.
import type { Summary } from './measures.ts';
import type { Event } from './record.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lane = 'buyer' | 'crow' | 'seller';

interface Step {
  lane: Lane;
  t: number;
  /** say: the agent's words. act: a tool call. note: a refusal, a stall, the owner's policy. chain: settlement. money: funds move. */
  kind: 'say' | 'act' | 'note' | 'chain' | 'money' | 'end';
  title: string;
  detail?: string;
  link?: string;
  count?: number;
  key?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …` : s);
/** Base units of a 6-decimal test token, with two decimals shown. */
const money = (m: J) => {
  const a = typeof m?.amount === 'string' && /^\d+$/.test(m.amount) ? BigInt(m.amount) : null;
  if (a === null) return '';
  const whole = a / 1_000_000n, cents = (a % 1_000_000n) / 10_000n;
  const token = typeof m?.token === 'string' && m.token.startsWith('0x') ? 'tUSDC' : String(m?.token ?? '');
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')} ${token}`;
};
const pathOf = (u: string) => { try { const x = new URL(u); return `${x.host}${x.pathname}`; } catch { return u; } };

/** A tool call in plain words. */
function act(name: string, input: J): { title: string; key: string } {
  const args: string[] = Array.isArray(input?.args) ? input.args.map(String) : [];
  if (name === 'fetch_url') {
    const u = String(input?.url ?? '');
    const p = pathOf(u);
    const what = /llms\.txt$/.test(p) ? 'the agent guide' : /sell\.txt$/.test(p) ? "the seller's page of the docs" : /\/sellers\//.test(p) ? "the seller's own page" : /\/v1\/commitments\//.test(p) ? 'the deal on an operator' : /\/defaults$/.test(p) ? "the seller's published defaults" : /\/jobs\//.test(p) ? 'the job API\'s report' : p;
    return { title: `Reads ${what}`, key: `fetch ${p}` };
  }
  if (name === 'run_command') {
    const c = String(input?.command ?? '');
    const first = args[0] ?? '';
    const t =
      c === 'buy-with-signer' ? (first === 'approve' ? 'Answers the stop: approves and funds the offer' : first === 'resume' ? 'Follows its funded deal' : 'Asks for a quote with the buyer\'s signer, which reads the offer and stops before signing')
      : c === 'seller-adapter' ? 'Starts the seller adapter: it signs offers, watches for the hold, and delivers'
      : c === 'adapter-log' ? "Reads the adapter's log"
      : c === 'check-delivery' ? 'Runs the agreed checks on a file'
      : c === 'seal' ? 'Delivers a report by hand: encrypts it and submits the delivery'
      : c === 'deal-record' ? 'Writes the deal record'
      : `Runs ${c}`;
    return { title: t, key: `run ${c} ${c === 'adapter-log' ? '' : JSON.stringify(args)}` };
  }
  if (name === 'write_file') return { title: `Writes ${String(input?.path ?? '')} in its folder`, key: `write ${input?.path}` };
  if (name === 'read_file') return { title: `Reads ${String(input?.path ?? '')} in its folder`, key: `read ${input?.path}` };
  if (name === 'list_files') return { title: 'Lists its folder', key: 'list' };
  if (name === 'wait') return { title: 'Waits', key: 'wait' };
  if (name === 'finish') return { title: 'Reports to its owner', key: 'finish' };
  return { title: `Calls ${name}`, key: `call ${name}` };
}

const CHAIN: Record<string, string> = {
  'commitment.offered': 'The seller\'s signed offer is posted',
  'adjudicator.accepted': 'The adjudicator accepts the terms',
  'commitment.agreed': 'The buyer agrees to the terms',
  'hold.funded': 'The hold is funded',
  'delivery.submitted': 'The encrypted work is delivered',
  'key.released': 'A decryption key is released',
  'judgment.decided': 'The adjudicator decides',
  'settlement.released': 'Released: the seller is paid',
  'settlement.refunded': 'Refunded: the price goes back to the buyer',
};

export function steps(events: readonly Event[]): Step[] {
  const start = events.find((e) => e.kind === 'run.start') as J;
  const t0 = start ? Date.parse(String(start.at)) - Number(start.t) : 0;
  const states = events.filter((e) => e.kind === 'chain.state') as J[];
  const party = (addr: unknown) => {
    const a = String(addr ?? '').toLowerCase();
    const st = states.find((s) => s.buyer === a || s.seller === a);
    return !a ? '' : st?.buyer === a ? 'the buyer' : st?.seller === a ? 'the seller' : 'the adjudicator';
  };
  const out: Step[] = [];
  const lane = (r: unknown): Lane => (r === 'buyer' ? 'buyer' : r === 'seller' ? 'seller' : 'crow');
  for (const e of events as J[]) {
    if (e.kind === 'model.turn' && typeof e.text === 'string' && e.text.trim()) out.push({ lane: lane(e.role), t: e.t, kind: 'say', title: cut(e.text.trim(), 900) });
    else if (e.kind === 'tool') {
      if (e.name === 'finish') { out.push({ lane: lane(e.role), t: e.t, kind: 'end', title: `Reports to its owner: ${cut(String(e.input?.outcome ?? ''), 200)}`, detail: cut(String(e.input?.report ?? ''), 900) }); continue; }
      const a = act(e.name, e.input);
      const failed = e.isError ? cut(String(e.result ?? '').split('\n').filter(Boolean).slice(0, 6).join(' '), 400) : undefined;
      if (e.name === 'wait') {
        const prev = out.at(-1);
        const s = Number(e.input?.seconds ?? 0) || 0;
        if (prev && prev.lane === lane(e.role) && prev.key === 'wait') { prev.count = (prev.count ?? 0) + s; prev.title = `Waits ${prev.count} s`; continue; }
        out.push({ lane: lane(e.role), t: e.t, kind: 'act', title: `Waits ${s} s`, key: 'wait', count: s });
        continue;
      }
      // A repeated poll collapses into one step with a count, skipping the waits between.
      const same = [...out].reverse().find((x) => x.lane === lane(e.role) && x.key !== 'wait');
      const between = out.slice(out.lastIndexOf(same as Step) + 1);
      if (same && same.key === a.key && !failed && between.every((x) => x.key === 'wait' || x.lane !== lane(e.role))) {
        same.count = (same.count ?? 1) + 1;
        same.title = `${a.title} (${same.count} times)`;
        for (const w of between) if (w.key === 'wait' && w.lane === lane(e.role)) out.splice(out.indexOf(w), 1);
        continue;
      }
      const detail = e.name === 'run_command' ? `${String(e.input?.command ?? '')} ${(e.input?.args ?? []).map((x: string) => cut(String(x), 120)).join(' ')}` : e.name === 'fetch_url' ? String(e.input?.url ?? '') : undefined;
      out.push({ lane: lane(e.role), t: e.t, kind: 'act', title: a.title, key: a.key, ...(detail ? { detail: cut(detail, 500) } : {}) });
      if (failed) out.push({ lane: lane(e.role), t: e.t, kind: 'note', title: failed.startsWith('Refused') ? 'Refused by its own tools' : 'It failed', detail: failed });
    } else if (e.kind === 'approval') out.push({ lane: 'buyer', t: e.t, kind: 'note', title: e.granted ? "The owner's pre-set policy approves: within the budget, with the required checks" : "The owner's pre-set policy refuses", detail: e.granted ? `Budget ${money({ amount: e.policy?.budget, token: '' })}; required checks ${(e.policy?.requiredChecks ?? []).join(', ')}` : (e.reasons ?? []).join('; ') });
    else if (e.kind === 'stall') out.push({ lane: lane(e.role), t: e.t, kind: 'note', title: `Stalled: ${String(e.reason ?? '')}`, detail: cut(String(e.error ?? e.trying ?? ''), 600) });
    else if (e.kind === 'agent.end' && e.status !== 'finished') out.push({ lane: lane(e.role), t: e.t, kind: 'end', title: `Stopped (${String(e.status)}): ${cut(String(e.outcome ?? ''), 200)}`, ...(e.trying ? { detail: cut(String(e.trying), 600) } : {}) });
    else if (e.kind === 'chain.event') {
      const t = Number.isFinite(Date.parse(String(e.at))) ? Date.parse(String(e.at)) - t0 : e.t;
      const link = typeof e.link === 'string' && /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]{64}$/.test(e.link) ? e.link : undefined;
      const base = CHAIN[e.type] ?? String(e.type);
      const title = e.type === 'judgment.decided' ? `The adjudicator decides: ${e.outcome === 'accept' ? 'the work passes the checks' : e.outcome === 'reject' ? 'the work fails a required check' : String(e.outcome ?? '')}`
        : e.type === 'key.released' ? `A decryption key is released to ${party(e.recipient) || 'a recipient'}` : base;
      const isMoney = ['hold.funded', 'settlement.released', 'settlement.refunded'].includes(e.type);
      const amount = e.type === 'hold.funded' ? money(e.amount) : '';
      const detail = e.type === 'hold.funded' ? `Buyer → escrow: ${amount}. Neither side can take it alone.` : e.type === 'settlement.released' ? 'Escrow → seller: the price. The buyer\'s key comes in the same step.' : e.type === 'settlement.refunded' ? 'Escrow → buyer: the price back. The work stays sealed.' : undefined;
      out.push({ lane: 'crow', t, kind: isMoney ? 'money' : 'chain', title, ...(detail ? { detail } : {}), ...(link ? { link } : {}) });
    }
  }
  return out.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.i - b.i).map((x) => x.s);
}

const vendorName = (v: string) => (v === 'anthropic' ? 'Anthropic' : v === 'deepseek' ? 'DeepSeek' : 'scripted');
const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const n = (x: number) => x.toLocaleString('en-US');
const usd = (micro: number | null) => (micro === null ? '' : `USD ${(micro / 1_000_000).toFixed(2)}`);

/** One-colour glyphs in a single stroke weight, 16 px, drawn in the current text colour. */
const ICON: Record<string, string> = {
  fetch: '<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c1.9 2 2.75 4 2.75 6.25S9.9 12.25 8 14.25M8 1.75C6.1 3.75 5.25 5.75 5.25 8S6.1 12.25 8 14.25"/>',
  run: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h2.75"/>',
  file: '<path d="M4 1.75h5l3 3v9.5H4z"/><path d="M9 1.75v3h3"/>',
  wait: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.25 1.5"/>',
  note: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v4M8 11.1v.15"/>',
  end: '<path d="M3.5 14.25V2M3.5 2.75h8l-1.75 3 1.75 3h-8"/>',
  chain: '<rect x="2" y="4.5" width="12" height="7" rx="3.5"/><path d="M6 8h4"/>',
  money: '<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="2"/><circle cx="8" cy="8" r="1.75"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
};
const icon = (name: string) => `<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ICON['note']}</svg>`;
const iconFor = (st: Step) => (st.kind === 'money' ? 'money' : st.kind === 'chain' ? 'chain' : st.kind === 'note' ? 'note' : st.kind === 'end' ? 'end' : st.key?.startsWith('fetch') ? 'fetch' : st.key?.startsWith('run') ? 'run' : st.key === 'wait' ? 'wait' : st.key?.startsWith('write') || st.key?.startsWith('read') || st.key === 'list' ? 'file' : 'note');

export function replayPage(events: readonly Event[], s: Summary): string {
  const start = events.find((e) => e.kind === 'run.start') as J;
  const world = events.find((e) => e.kind === 'world') as J;
  const end = events.at(-1);
  const list = steps(events);
  const scripted = s.models.buyer.vendor === 'scripted' && s.models.seller.vendor === 'scripted';
  const model = (r: 'buyer' | 'seller') => (s.models[r].vendor === 'scripted' ? 'Scripted stand-in' : `${vendorName(s.models[r].vendor)} · ${s.models[r].model.replace(/@.*$/, '')}`);
  const who = (r: 'buyer' | 'seller') => (s.models[r].vendor === 'scripted' ? 'a scripted stand-in with no model' : `${vendorName(s.models[r].vendor)}'s ${s.models[r].model.replace(/@.*$/, '')}`);
  const lead = scripted
    ? 'A rehearsal of the harness. Both sides are scripted: a fixed list of tool calls with no model behind them. It shows that the runner, the tools, the record and this page work end to end. Only a live run shows what a model does.'
    : `A real run. The buyer is ${who('buyer')} and the seller is ${who('seller')}: two models${s.models.buyer.vendor !== s.models.seller.vendor ? ' from two vendors' : ''}, each working its own tools through Crow's public API. They never spoke to each other directly, and nobody typed anything while it ran.`;
  const preset = [
    "each agent's brief",
    `the buyer's approval policy: a budget of ${money({ amount: start?.policy?.budget, token: '' }).trim()} test tokens, the required checks ${(start?.policy?.requiredChecks ?? []).join(' and ')}, the report due within ${Math.round(Number(start?.policy?.latestDeliverySec ?? 0) / 86_400)} days, and an offer dated within ${Math.round(Number(start?.policy?.createdAtBandSec ?? 0) / 60)} minutes of now`,
    ...(start?.sellerRule ? [`the seller's rule: “${cut(String(start.sellerRule), 240).replace(/[.\s]+$/, '')}”`] : []),
  ];
  const ok = s.decisionRight;
  const engine = String(world?.engine ?? s.engine ?? 'an unknown engine');
  const engineShort = world?.local ? 'Local simulator · phase-one rules' : `${engine.charAt(0).toUpperCase()}${engine.slice(1)}`;
  const row = (label: string, value: string, extra = '') => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${extra}${esc(value)}</span></div>`;
  const avatar = (r: 'buyer' | 'seller') => `<span class="avatar ${r}" aria-hidden="true">${r === 'buyer' ? 'B' : 'S'}</span>`;

  const item = (st: Step, i: number) => {
    const side = st.lane;
    if (st.kind === 'say') return `<li class="step ${side} say" data-i="${i}"><div class="bubble"><p>${esc(st.title)}</p></div><span class="meta">${side === 'buyer' ? 'Buyer' : 'Seller'} · ${secs(Math.max(0, st.t))}</span></li>`;
    if (side === 'crow') {
      const amount = st.kind === 'money' && st.detail ? st.detail : '';
      return `<li class="step crow ${st.kind}" data-i="${i}"><div class="capsule">${icon(iconFor(st))}<span><strong>${esc(st.title)}</strong>${amount ? `<span class="sub">${esc(amount)}</span>` : st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}${st.link ? `<a class="sub" href="${esc(st.link)}" rel="noopener">View transaction</a>` : ''}</span><span class="time">${secs(Math.max(0, st.t))}</span></div></li>`;
    }
    return `<li class="step ${side} ${st.kind}" data-i="${i}"><div class="action">${icon(iconFor(st))}<span><span class="title">${esc(st.title)}</span>${st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ''}</span></div></li>`;
  };

  const tile = (title: string, value: string, note: string, tone = '') => `<div class="tile ${tone}"><span class="tile-title">${esc(title)}</span><span class="tile-value">${esc(value)}</span><span class="tile-note">${esc(note)}</span></div>`;
  const stallNote = s.stalls.map((x) => `${x.role}: ${x.reason}${x.detail ? ` (${cut(x.detail, 160)})` : ''}`).join(' · ');
  const tiles = [
    tile('Right decision', ok ? 'Yes' : 'No', s.why, ok ? 'good' : 'bad'),
    tile('Tokens', n(s.tokens.deal), `Buyer ${n(s.tokens.buyer.input + s.tokens.buyer.output)} · Seller ${n(s.tokens.seller.input + s.tokens.seller.output)}${scripted ? ' · scripted counts are characters ÷ 4' : ''}${s.costMicroUsd.buyer !== null || s.costMicroUsd.seller !== null ? ` · list price ${usd((s.costMicroUsd.buyer ?? 0) + (s.costMicroUsd.seller ?? 0))}` : ''}`),
    tile('Turns and calls', `${s.calls.buyer.turns + s.calls.seller.turns} turns`, `${s.calls.buyer.toolCalls + s.calls.seller.toolCalls} tool calls · ${s.calls.buyer.apiCalls + s.calls.seller.apiCalls} API calls · ${s.calls.buyer.refused + s.calls.seller.refused} refused by the tools`),
    tile('Stalls', String(s.stalls.length), stallNote || 'No call failed the same way twice, and no cap was hit.', s.stalls.length ? 'bad' : ''),
    tile('Human interventions', String(s.humanInterventions), `${s.ownerApprovals.length} approval${s.ownerApprovals.length === 1 ? '' : 's'} answered by the owner's pre-set policy`),
    tile('Work passes → seller paid', s.workPassesToPaidSec === null ? '—' : `${s.workPassesToPaidSec} s`, s.workPassesToPaidSec === null ? 'Nobody was paid in this run.' : 'Settlement time, whole seconds, from the decision to the release.'),
    tile('Forbidden terms agreed', s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove ? 'Yes' : 'No', s.forbiddenTerms.detail || 'The buyer approved only terms its brief allows.', s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove ? 'bad' : ''),
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deal Replay</title>
<style>
:root{--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;--canvas:#f5f5f7;--surface:#ffffff;--fill:#e9e9eb;--line:rgba(60,60,67,.12);--ink:#1d1d1f;--ink2:#6e6e73;--ink3:#8e8e93;--accent:#007aff;--accent-ink:#ffffff;--green:#248a3d;--red:#d70015;--wash-green:#e8f6ec;--wash-red:#fdecee;--r-sm:6px;--r-md:8px;--r-lg:10px;--r-win:12px;--arrive:cubic-bezier(.25,.8,.25,1);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--canvas:#000000;--surface:#1c1c1e;--fill:#2c2c2e;--line:rgba(84,84,88,.6);--ink:#f5f5f7;--ink2:#98989d;--ink3:#7c7c80;--accent:#0a84ff;--green:#30d158;--red:#ff453a;--wash-green:#132a1a;--wash-red:#2e1416}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.4 var(--font);-webkit-font-smoothing:antialiased}
.toolbar{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line)}
.toolbar-inner{max-width:880px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.app{font-weight:600;font-size:15px}
.app small{display:block;font-weight:400;font-size:12px;color:var(--ink2)}
.spacer{flex:1}
.seg{display:flex;background:var(--fill);border-radius:var(--r-md);padding:2px;gap:2px}
.seg button{font:inherit;font-size:13px;font-weight:500;border:0;background:transparent;color:var(--ink);border-radius:var(--r-sm);padding:5px 12px;cursor:pointer}
.seg button:hover{background:var(--surface)}
.seg button.primary{background:var(--accent);color:var(--accent-ink)}
.progress{height:3px;background:var(--fill)}
.progress span{display:block;height:100%;width:100%;background:var(--accent);transition:width .5s var(--arrive)}
main{max-width:880px;margin:0 auto;padding:28px 16px 64px}
.engine{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--ink2)}
.callout{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border-radius:var(--r-win);padding:12px 16px;margin:14px 0 0;font-size:14px}
.callout p{margin:0}.callout .glyph{color:var(--accent);margin-top:2px}
.large{font-size:34px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:0}
.subtitle{color:var(--ink2);font-size:17px;margin:6px 0 0}
.lead{margin:16px 0 0;font-size:15px;max-width:680px}
.section{font-size:13px;color:var(--ink2);text-transform:uppercase;letter-spacing:.02em;margin:28px 12px 8px}
.group{background:var(--surface);border-radius:var(--r-win);overflow:hidden}
.row{display:flex;align-items:center;gap:12px;padding:11px 16px;min-height:44px}
.row+.row{border-top:1px solid var(--line);margin-left:16px;padding-left:0}
.row .label{flex:0 0 132px;color:var(--ink2)}
.row .value{flex:1;display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:600}
.badge.good{background:var(--wash-green);color:var(--green)}.badge.bad{background:var(--wash-red);color:var(--red)}
.footnote{font-size:13px;color:var(--ink2);margin:8px 16px 0}
.avatar{width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff}
.avatar.buyer{background:#8e8e93}.avatar.seller{background:var(--accent)}
.conversation{background:var(--surface);border-radius:var(--r-win);padding:16px 12px 20px}
.heads{display:flex;justify-content:space-between;padding:0 4px 12px;border-bottom:1px solid var(--line);margin-bottom:12px;font-size:13px;color:var(--ink2)}
.heads span{display:flex;align-items:center;gap:8px}
ol.run{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.step{display:flex;flex-direction:column;max-width:72%}
.step.buyer{align-self:flex-start;align-items:flex-start}
.step.seller{align-self:flex-end;align-items:flex-end}
.step.crow{align-self:center;max-width:88%;margin:6px 0}
.step.reveal{animation:arrive .8s var(--arrive) both}
@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.bubble{border-radius:18px;padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.bubble p{margin:0}
.buyer .bubble{background:var(--fill);color:var(--ink);border-bottom-left-radius:6px}
.seller .bubble{background:var(--accent);color:var(--accent-ink);border-bottom-right-radius:6px}
.meta{font-size:11px;color:var(--ink3);margin:3px 8px 0}
.action{display:flex;gap:8px;align-items:flex-start;color:var(--ink2);font-size:13px;padding:2px 8px}
.seller .action{flex-direction:row-reverse;text-align:right}
.action .title{display:block;color:var(--ink2)}
.sub{display:block;font-size:12px;color:var(--ink3);overflow-wrap:anywhere;white-space:pre-wrap}
.note .action,.end .action{background:var(--canvas);border-radius:var(--r-lg);padding:8px 12px}
.note .action .title{color:var(--red)}
.end .action .title{color:var(--ink);font-weight:600}
.glyph{width:16px;height:16px;flex:0 0 16px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.capsule{display:flex;align-items:center;gap:10px;background:var(--canvas);border-radius:999px;padding:7px 14px;font-size:13px;color:var(--ink)}
.capsule strong{font-weight:600}
.capsule .time{font-size:11px;color:var(--ink3);white-space:nowrap}
.money .capsule{background:var(--wash-green);border-radius:var(--r-win);padding:10px 16px}
.money .capsule .glyph{color:var(--green)}
.capsule a{color:var(--accent);text-decoration:none}
.hidden{display:none}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tile{background:var(--surface);border-radius:var(--r-win);padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.tile:first-child{grid-column:1/-1}
.tile-title{font-size:13px;font-weight:600;color:var(--ink2)}
.tile-value{font-size:28px;font-weight:700;letter-spacing:-.01em}
.tile-note{font-size:13px;color:var(--ink2)}
.tile.good .tile-value{color:var(--green)}.tile.bad .tile-value{color:var(--red)}
footer{font-size:12px;color:var(--ink3);margin:28px 12px 0;max-width:680px}
@media (max-width:600px){.step{max-width:88%}.row .label{flex-basis:96px}.app small{display:none}.large{font-size:28px}}
</style>
</head>
<body>
<div class="toolbar"><div class="toolbar-inner"><div class="app">Deal Replay<small>${esc(s.title)}</small></div><div class="spacer"></div><div class="seg" id="controls" hidden><button id="back" type="button" aria-label="Previous step">Back</button><button id="play" type="button" class="primary">Play</button><button id="next" type="button" aria-label="Next step">Next</button><button id="all" type="button">All</button></div></div><div class="progress"><span id="bar"></span></div></div>
<main>
<p class="engine">This run used ${esc(engine)}.</p>
<div class="large">Two agents, one deal</div>
<p class="subtitle">${esc(s.title)}</p>
<p class="lead">${esc(lead)} Test tokens only: nothing here is real money.</p>

<div class="section">About this run</div>
<div class="group">
${row('Buyer', model('buyer'), avatar('buyer'))}
${row('Seller', model('seller'), avatar('seller'))}
${row('Engine', engineShort)}
${row('Expected', s.expect)}
${row('Outcome', '', `<span class="badge ${ok ? 'good' : 'bad'}">${esc(s.outcome.state)}</span> `)}
${row('Run time', end ? secs(Number(end.t)) : '')}
</div>
<p class="footnote">Set by the owners before the run: ${esc(preset.join('; '))}. Every other choice, each agent made itself.</p>
${start?.note ? `<div class="callout">${icon('note')}<p>${esc(String(start.note))}</p></div>` : ''}

<div class="section">The deal, step by step</div>
<div class="conversation">
<div class="heads"><span>${avatar('buyer')} Buyer</span><span>Crow and the chain</span><span>Seller ${avatar('seller')}</span></div>
<ol class="run" id="run">
${list.map(item).join('\n')}
</ol>
</div>

<div class="section">Summary</div>
<div class="tiles">${tiles}</div>
<footer>Generated from this run's record (record.jsonl) and nothing else. Agents' words appear as they wrote them; anything they quoted from a page, an offer or a report is shown as text. Keys never appear: the agents never held them, and the record replaces any it meets with [secret].${start?.checkout?.commit ? ` Code ${esc(String(start.checkout.commit).slice(0, 12))}${start.checkout.dirty ? ', with local changes' : ''}.` : ''}</footer>
</main>
<script>
(function(){
  var items=[].slice.call(document.querySelectorAll('#run .step'));
  if(!items.length)return;
  var at=items.length-1,timer=null,bar=document.getElementById('bar'),play=document.getElementById('play');
  document.getElementById('controls').hidden=false;
  function show(fresh){items.forEach(function(el,i){el.classList.toggle('hidden',i>at);el.classList.toggle('reveal',fresh&&i===at)});bar.style.width=((at+1)/items.length*100)+'%';if(fresh&&items[at].scrollIntoView)items[at].scrollIntoView({block:'nearest',behavior:'smooth'})}
  function stop(){if(timer){clearInterval(timer);timer=null;play.textContent='Play'}}
  function next(){if(at<items.length-1){at++;show(true)}else stop()}
  function back(){if(at>0){at--;show(false)}}
  play.onclick=function(){if(timer){stop();return}if(at>=items.length-1){at=0;show(true)}timer=setInterval(next,1400);play.textContent='Pause'};
  document.getElementById('next').onclick=function(){stop();next()};
  document.getElementById('back').onclick=function(){stop();back()};
  document.getElementById('all').onclick=function(){stop();at=items.length-1;show(false)};
  document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){stop();next()}else if(e.key==='ArrowLeft'){stop();back()}else if(e.key===' '){e.preventDefault();play.onclick()}});
  show(false);
})();
</script>
</body>
</html>
`;
}
