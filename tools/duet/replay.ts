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
    else if (e.kind === 'agent.end' && e.status !== 'finished') out.push({ lane: lane(e.role), t: e.t, kind: 'end', title: `Stopped (${String(e.status)}): ${cut(String(e.outcome ?? ''), 200)}`, detail: e.trying ? cut(String(e.trying), 600) : undefined });
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

export function replayPage(events: readonly Event[], s: Summary): string {
  const start = events.find((e) => e.kind === 'run.start') as J;
  const world = events.find((e) => e.kind === 'world') as J;
  const end = events.at(-1);
  const list = steps(events);
  const scripted = s.models.buyer.vendor === 'scripted' && s.models.seller.vendor === 'scripted';
  const who = (r: 'buyer' | 'seller') => (s.models[r].vendor === 'scripted' ? 'a scripted stand-in (no model)' : `${vendorName(s.models[r].vendor)}'s ${s.models[r].model.replace(/@.*$/, '')}`);
  const lead = scripted
    ? 'You are watching a rehearsal of the harness: both sides here are scripted, a fixed list of tool calls with no model behind them. It shows that the runner, the tools, the record and this page work end to end; only a live run shows what a model does.'
    : `You are watching a real run. The buyer is ${who('buyer')} and the seller is ${who('seller')}: two models${s.models.buyer.vendor !== s.models.seller.vendor ? ' from two vendors' : ''}, each driving its own tools through Crow's public API. They never talked to each other directly, and nobody typed anything while it ran.`;
  const preset = [
    'Each agent\'s brief from its owner',
    `the buyer's approval policy: a budget of ${money({ amount: start?.policy?.budget, token: '' }).trim()} test tokens and the required checks ${(start?.policy?.requiredChecks ?? []).join(' and ')}`,
    ...(start?.sellerRule ? [`the seller's rule: "${cut(String(start.sellerRule), 240)}"`] : []),
  ];
  const card = (st: Step, i: number) => {
    const cls = `step ${st.lane} ${st.kind}`;
    const label = st.lane === 'crow' ? '' : st.kind === 'say' ? `<span class="who">${st.lane === 'buyer' ? 'Buyer' : 'Seller'} says</span>` : '';
    return `<li class="${cls}" data-i="${i}"><span class="time">${secs(Math.max(0, st.t))}</span><div class="body">${label}<p class="title">${esc(st.title)}</p>${st.detail ? `<p class="detail">${esc(st.detail)}</p>` : ''}${st.link ? `<p class="detail"><a href="${esc(st.link)}" rel="noopener">The transaction on Sepolia Etherscan</a></p>` : ''}</div></li>`;
  };
  const yes = (b: boolean) => (b ? 'Yes' : 'No');
  const measure = (num: string, title: string, value: string, note = '') => `<div class="measure"><span class="num">${num}</span><h3>${esc(title)}</h3><p class="value">${esc(value)}</p>${note ? `<p class="note">${esc(note)}</p>` : ''}</div>`;
  const stallNote = s.stalls.map((x) => `${x.role}: ${x.reason}${x.detail ? `: ${cut(x.detail, 200)}` : ''}`).join(' · ');
  const measures = [
    measure('1', 'Tokens', `${n(s.tokens.deal)} for the deal`, `Buyer ${n(s.tokens.buyer.input)} in, ${n(s.tokens.buyer.output)} out. Seller ${n(s.tokens.seller.input)} in, ${n(s.tokens.seller.output)} out.${scripted ? ' Scripted sides count characters divided by four.' : ''}${s.costMicroUsd.buyer !== null || s.costMicroUsd.seller !== null ? ` List price: buyer ${usd(s.costMicroUsd.buyer) || 'n/a'}, seller ${usd(s.costMicroUsd.seller) || 'n/a'}.` : ''}`),
    measure('2', 'Turns and calls', `${s.calls.buyer.turns + s.calls.seller.turns} model turns, ${s.calls.buyer.toolCalls + s.calls.seller.toolCalls} tool calls`, `Buyer ${s.calls.buyer.turns} turns, ${s.calls.buyer.toolCalls} tool calls, ${s.calls.buyer.apiCalls} API calls. Seller ${s.calls.seller.turns} turns, ${s.calls.seller.toolCalls} tool calls, ${s.calls.seller.apiCalls} API calls. Refused by the tools: ${s.calls.buyer.refused + s.calls.seller.refused}.`),
    measure('3', 'Stalls on an unclear error', String(s.stalls.length), stallNote || 'No call failed the same way twice, and no cap was hit.'),
    measure('4', 'Human interventions', String(s.humanInterventions), `Approvals answered by the owner's pre-set policy: ${s.ownerApprovals.length} (${s.ownerApprovals.filter((a) => a.granted).length} granted).`),
    measure('5', 'From "the work passes" to "the seller is paid"', s.workPassesToPaidSec === null ? 'Not paid' : `${s.workPassesToPaidSec} s`, s.workPassesToPaidSec === null ? 'No release in this run.' : 'Settlement-layer time, in whole seconds: from the decision that the work passes to the release.'),
    measure('6', 'Agreed to terms its brief forbade', yes(s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove), s.forbiddenTerms.detail || 'No: the buyer funded and asked to approve only terms its brief allows.'),
    measure('7', 'The right decision for the scenario', yes(s.decisionRight), s.why),
  ].join('');
  const duration = end ? secs(Number(end.t)) : '';
  const worldLine = world?.local ? 'a local test world (SimChain, test tokens only)' : `the test network with chain ID ${esc(String(world?.chainId ?? ''))} (test tokens only)`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crow duet replay</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&display=swap">
<style>
:root{--paper:#faf7f0;--card:#ffffff;--ink:#2f2d2a;--pencil:#6b665d;--rule:#e2dccf;--sepia:#8a6237;--ok:#5f9c6a;--warn:#a5533a;--buyer:#3c6e8f;--seller:#8a5a2b;--crow:#5b5a8c;--display:"EB Garamond",Garamond,"Times New Roman",serif;--text:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--text)}
main{max-width:1120px;margin:0 auto;padding:40px 16px 80px}
.mark{font-family:var(--display);font-size:20px;color:var(--sepia);letter-spacing:.02em}
h1{font-family:var(--display);font-weight:600;font-size:40px;line-height:1.1;margin:10px 0 6px}
h2{font-family:var(--display);font-weight:600;font-size:26px;margin:48px 0 12px}
h3{font-size:13px;font-weight:600;margin:4px 0;color:var(--pencil)}
.sub{font-family:var(--display);font-size:21px;color:var(--pencil);margin:0 0 18px}
.lead{max-width:760px;font-size:16px}
.preset{max-width:760px;color:var(--pencil);font-size:14px}
.facts{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--pencil);font-size:13px;margin:14px 0 0;padding:0;list-style:none}
.lanes{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 18px;position:sticky;top:0;background:var(--paper);padding:14px 0 10px;border-bottom:1px solid var(--rule);z-index:2;margin-top:28px}
.lanes div{font-family:var(--display);font-size:19px;font-weight:600}
.lanes .buyer{color:var(--buyer)}.lanes .crow{color:var(--crow);text-align:center}.lanes .seller{color:var(--seller);text-align:right}
.lanes small{display:block;font-family:var(--text);font-size:12px;font-weight:400;color:var(--pencil)}
ol.run{list-style:none;margin:0;padding:12px 0 0;position:relative}
ol.run::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--rule)}
.step{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 18px;margin:8px 0;position:relative;transition:opacity .4s}
.step .body{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:10px 14px;box-shadow:0 1px 2px rgba(60,50,30,.05)}
.step.buyer .body{grid-column:1;border-left:3px solid var(--buyer)}
.step.seller .body{grid-column:3;border-right:3px solid var(--seller)}
.step.crow .body{grid-column:2;text-align:center;border-color:#d8d6ea;background:#f6f5fb}
.step.money .body{background:#eef5ef;border-color:#cfe2d2}
.step.note .body{background:#fbf3ee;border-color:#ecd5c9}
.step.end .body{border-width:1px 1px 1px 3px}
.step .time{position:absolute;left:50%;transform:translate(-50%,-55%);top:0;font-size:11px;color:var(--pencil);background:var(--paper);padding:0 6px;display:none}
.step.crow .time{display:block}
.who{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pencil)}
.title{margin:0}
.step.say .title{font-family:var(--display);font-size:17px;line-height:1.4;white-space:pre-wrap}
.step.money .title,.step.chain .title{font-weight:600}
.detail{margin:4px 0 0;font-size:12.5px;color:var(--pencil);overflow-wrap:anywhere;white-space:pre-wrap}
a{color:var(--crow)}
.controls{display:flex;gap:10px;align-items:center;margin:18px 0 0}
button{font:inherit;font-size:14px;border:1px solid var(--rule);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
button:hover{border-color:var(--pencil)}
.counter{color:var(--pencil);font-size:13px}
.hidden{display:none}
.measures{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.measure{background:var(--card);border:1px solid var(--rule);border-radius:12px;padding:14px 16px;position:relative}
.measure .num{position:absolute;right:14px;top:10px;font-family:var(--display);color:var(--rule);font-size:28px}
.measure .value{font-family:var(--display);font-size:24px;margin:2px 0}
.measure .note{font-size:12.5px;color:var(--pencil);margin:4px 0 0}
footer{margin-top:48px;color:var(--pencil);font-size:12.5px;max-width:760px}
@media (max-width:760px){.lanes{display:none}ol.run::before{display:none}.step{grid-template-columns:1fr}.step .body,.step.buyer .body,.step.seller .body,.step.crow .body{grid-column:1}.step .body::before{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pencil)}.step.buyer .body::before{content:"Buyer"}.step.seller .body::before{content:"Seller"}.step.crow .body::before{content:"Crow and the chain"}h1{font-size:32px}}
</style>
</head>
<body>
<main>
<div class="mark" aria-label="Crow">’crow</div>
<h1>Two agents, one deal</h1>
<p class="sub">${esc(s.title)}${s.scenario ? ` · the ${esc(s.scenario)} scenario` : ''}</p>
<p class="lead">${esc(lead)} The deal ran on ${worldLine}: nothing here is real money.</p>
<p class="preset"><strong>Pre-set by an owner before the run:</strong> ${esc(preset.join('; '))}. Everything else, each agent decided itself.</p>
<p class="preset"><strong>What should happen:</strong> ${esc(s.expect)}</p>
<ul class="facts"><li>Buyer: ${esc(who('buyer'))}</li><li>Seller: ${esc(who('seller'))}</li><li>Run time: ${esc(duration)}</li><li>Outcome: ${esc(s.outcome.state)}</li>${start?.checkout?.commit ? `<li>Code: ${esc(String(start.checkout.commit).slice(0, 12))}${start.checkout.dirty ? ' (with local changes)' : ''}</li>` : ''}</ul>
<div class="controls" id="controls" hidden><button id="back" type="button">Back</button><button id="next" type="button">Next step</button><button id="play" type="button">Play</button><button id="all" type="button">Show all</button><span class="counter" id="counter"></span></div>
<section class="stage">
<div class="lanes" aria-hidden="true"><div class="buyer">Buyer<small>${esc(who('buyer'))}</small></div><div class="crow">Crow and the chain<small>operators, adjudicator, settlement</small></div><div class="seller">Seller<small>${esc(who('seller'))}</small></div></div>
<ol class="run" id="run">
${list.map(card).join('\n')}
</ol>
</section>
<h2>The measures</h2>
<div class="measures">${measures}</div>
<footer>This page was generated from the run's record (record.jsonl) and nothing else. Agents' words appear as they wrote them; any page, offer or report they quoted is shown as text. Keys never appear: the agents never held them, and the record replaces any it meets with [secret]. Scripted token counts are characters divided by four.</footer>
</main>
<script>
(function(){
  var items=[].slice.call(document.querySelectorAll('#run .step'));
  if(!items.length)return;
  var at=0,timer=null,c=document.getElementById('controls');c.hidden=false;
  function show(){items.forEach(function(el,i){el.classList.toggle('hidden',i>at)});document.getElementById('counter').textContent='Step '+(at+1)+' of '+items.length;var el=items[at];if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest',behavior:'smooth'})}
  function next(){if(at<items.length-1){at++;show()}else stop()}
  function stop(){if(timer){clearInterval(timer);timer=null;document.getElementById('play').textContent='Play'}}
  document.getElementById('next').onclick=function(){stop();next()};
  document.getElementById('back').onclick=function(){stop();if(at>0){at--;show()}};
  document.getElementById('play').onclick=function(){if(timer){stop()}else{timer=setInterval(next,1600);this.textContent='Pause'}};
  document.getElementById('all').onclick=function(){stop();at=items.length-1;show()};
  document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();stop();next()}else if(e.key==='ArrowLeft'){stop();if(at>0){at--;show()}}});
  show();
})();
</script>
</body>
</html>
`;
}
