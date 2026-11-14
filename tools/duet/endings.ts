// The section "Three ways a deal ends" under the demo's player (T-427, Rafa 2026-11-14: "Yes, build it"): three live
// test deals on Sepolia, one per ending, each with its rule, its measured time, its amount and its public record. The
// deals and their numbers live in endings.json, so a refresh is a data change and one publish. The seconds are computed
// from the record's own times, so a reader can check them against the linked record.
//
// Without scripts the three cards stack, all readable. With scripts a three-way switch shows one card at a time; arrow
// keys move between its tabs. Nothing animates.
import { readFileSync } from 'node:fs';

export interface Ending {
  key: string;
  title: string;
  rule: string;
  measure: string;
  amount: { base: string; label: string };
  how: string;
  commitment: string;
  offeredAt: string;
  deliverBy?: string;
  endedAt: string;
  tx: string;
}
export interface Endings {
  date: string;
  record: string;
  explorer: string;
  endings: Ending[];
}

export const ENDINGS: Endings = JSON.parse(readFileSync(new URL('./endings.json', import.meta.url), 'utf8'));

const HEX32 = /^0x[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Refuses a data file the section cannot show honestly: a bad ID, hash, time or amount fails the build, not the page. */
export function checkEndings(e: Endings): void {
  const fail = (m: string): never => { throw new Error(`tools/duet/endings.json: ${m}`); };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail('date is not YYYY-MM-DD');
  if (e.record !== 'https://api.crow.direct/v1/commitments/') fail('record must be the live API');
  if (e.explorer !== 'https://sepolia.etherscan.io/tx/') fail('explorer must be Sepolia Etherscan');
  if (e.endings.length !== 3) fail('three endings, one per card');
  for (const x of e.endings) {
    if (!HEX32.test(x.commitment) || !HEX32.test(x.tx)) fail(`${x.key}: commitment and tx are 32-byte lowercase hex`);
    if (!ISO.test(x.offeredAt) || !ISO.test(x.endedAt) || (x.deliverBy !== undefined && !ISO.test(x.deliverBy))) fail(`${x.key}: times are UTC ISO 8601 to the second`);
    if (!x.offeredAt.startsWith(e.date)) fail(`${x.key}: not from ${e.date}`);
    if (seconds(x.offeredAt, x.endedAt) <= 0) fail(`${x.key}: ends before it starts`);
    if (!/^[1-9]\d*$/.test(x.amount.base)) fail(`${x.key}: amount is a whole number of base units`);
  }
}

export const seconds = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 1000);
/** 68 s; 6 min 5 s from two minutes on. */
export const duration = (s: number) => (s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
/** tUSDC has six decimals; these amounts are whole test dollars. */
export const testDollars = (base: string) => {
  const b = BigInt(base), whole = b / 1_000_000n, rest = b % 1_000_000n;
  const n = rest === 0n ? whole.toString() : `${whole}.${rest.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${n} test ${n === '1' ? 'dollar' : 'dollars'}`;
};
checkEndings(ENDINGS);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

export const ENDINGS_CSS = `/* Three ways a deal ends (T-427): stacked cards without scripts, one card at a time with the switch. */
.endings{max-width:860px;margin:56px auto 0;padding-top:40px;border-top:1px solid var(--line)}
@media (min-width:980px){#demo-view>.endings{grid-column:1/-1;width:100%}}
.endings h2{font-family:var(--display);font-size:32px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:6px 0 8px}
.endings-lead{font-size:17px;line-height:1.5;color:var(--ink-2);margin:0 0 20px;max-width:680px}
.endings-switch{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;border:1px solid var(--line);border-radius:999px;margin:0 0 16px}
.endings-switch[hidden]{display:none}
.endings-switch button{font:inherit;font-size:14px;color:var(--ink-2);background:transparent;border:0;border-radius:999px;padding:8px 14px;min-height:36px;cursor:pointer}
.endings-switch button[aria-selected="true"]{background:var(--ink);color:var(--page)}
.endings-switch button:focus-visible,.ending a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.endings-cards{display:grid;gap:16px}
.ending{border:1px solid var(--line);border-radius:var(--r-card);padding:22px 24px;background:var(--page)}
.ending[hidden]{display:none}
.ending h3{font-size:20px;font-weight:600;margin:0 0 6px}
.ending-rule{font-size:17px;margin:0 0 16px}
.ending-facts{display:flex;flex-wrap:wrap;gap:12px 32px;margin:0 0 14px}
.ending-facts div{display:flex;flex-direction:column;gap:2px}
.ending-facts dt{order:2;font-size:13px;color:var(--ink-2)}
.ending-facts dd{order:1;margin:0;font-family:var(--display);font-size:26px;font-weight:700;letter-spacing:-.01em}
.ending-how{font-size:15px;color:var(--ink-2);margin:0 0 14px;max-width:640px}
.ending-links{display:flex;flex-wrap:wrap;gap:6px 24px;margin:0;padding:0;list-style:none;font-size:15px}
.ending-links a{color:var(--ink);font-weight:500}
.endings-try{font-size:15px;color:var(--ink-2);margin:20px 0 0}
.endings-try a{color:var(--ink);font-weight:500}
@media (max-width:600px){.endings{margin-top:40px;padding-top:28px}.endings h2{font-size:26px}.endings-switch{display:grid;grid-template-columns:repeat(3,1fr);width:100%;border-radius:var(--r-card)}.endings-switch button{border-radius:calc(var(--r-card) - 3px);font-size:13px;line-height:1.25;padding:8px 6px}.ending{padding:18px}.ending-facts dd{font-size:22px}}`;

/** The section's HTML. Its switch starts hidden and its cards all show: the script below turns the switch on. */
export function endingsSection(e: Endings = ENDINGS): string {
  const card = (x: Ending) => `<article class="ending" id="ending-${esc(x.key)}" role="tabpanel" aria-labelledby="ending-tab-${esc(x.key)}">
<h3>${esc(x.title)}</h3>
<p class="ending-rule">${esc(x.rule)}</p>
<dl class="ending-facts"><div><dt>${esc(x.measure)}</dt><dd>${duration(seconds(x.offeredAt, x.endedAt))}</dd></div><div><dt>${esc(x.amount.label)}</dt><dd>${testDollars(x.amount.base)}</dd></div></dl>
<p class="ending-how">${esc(x.how)}</p>
<ul class="ending-links"><li><a href="${esc(e.record + x.commitment)}" rel="noopener" target="_blank">The deal's record on the live service ›</a></li><li><a href="${esc(e.explorer + x.tx)}" rel="noopener" target="_blank" aria-label="The final transaction on the Sepolia test network, ${short(x.tx)}">The final transaction on Sepolia ›</a></li></ul>
</article>`;
  return `<section class="endings" id="endings" aria-labelledby="endings-title">
<p class="eyebrow">Live on the public test network</p>
<h2 id="endings-title">Three ways a deal ends</h2>
<p class="endings-lead">The demo above is a sample deal on a local test setup. These three ran on Crow's live service on ${day(e.date)}, between a test buyer and Crow's test seller, in test dollars. Each number is from that one deal, and each deal's record is public.</p>
<div class="endings-switch" role="tablist" aria-label="How the deal ended" hidden>${e.endings.map((x, i) => `<button type="button" role="tab" id="ending-tab-${esc(x.key)}" aria-controls="ending-${esc(x.key)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(x.title)}</button>`).join('')}</div>
<div class="endings-cards">
${e.endings.map(card).join('\n')}
</div>
<p class="endings-try">Try one yourself: one command buys from the same test seller, in test dollars. <a href="https://crow.direct/llms.txt" rel="noopener" target="_blank">The front page for agents ›</a></p>
</section>`;
}

/** Turns the stacked cards into a switch: one card at a time, arrow keys between the tabs, no animation. */
export const ENDINGS_SCRIPT = `(function(){
  var root=document.getElementById('endings');if(!root)return;
  var bar=root.querySelector('.endings-switch'),tabs=[].slice.call(bar.querySelectorAll('[role="tab"]'));
  function pick(i,focus){tabs.forEach(function(t,j){var on=i===j;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!on});if(focus)tabs[i].focus()}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){pick(i,false)});t.addEventListener('keydown',function(e){var k=e.key,n=tabs.length;if(k==='ArrowRight'||k==='ArrowLeft'||k==='Home'||k==='End'){e.preventDefault();pick(k==='Home'?0:k==='End'?n-1:(i+(k==='ArrowRight'?1:n-1))%n,true)}})});
  bar.hidden=false;pick(0,false);
})();`;
