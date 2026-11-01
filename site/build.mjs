// site/llms.txt is the one source. This renders it into site/index.html (placeholders kept), or, for
// publishing, writes both files with the operator URLs filled in.
//
//   node site/build.mjs                                   regenerate site/index.html
//   node site/build.mjs --op1 URL --op2 URL --out DIR
//                                                         filled llms.txt and index.html in DIR, ready to publish
//                                                         under /escrow/; refuses while a "%% CONFIRM" note remains
//
// Lines starting with "%% " in llms.txt are editor notes: they never reach a published file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SITE_URL = 'https://escrow.stream/';
/** The path the site is served under ('/' on escrow.stream); every link is absolute from it. */
export const BASE = new URL(SITE_URL).pathname;
const here = (p) => new URL(p, import.meta.url);

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = (s) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[^\s<)]+[^\s<).,;:])/g, '<a href="$1">$1</a>')))
    .join('');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The small Markdown subset llms.txt uses: headings, paragraphs, lists, tables, fenced code. */
export function render(md) {
  const lines = md.split('\n'), out = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^#{2,3} /.test(line)) {
      const level = line.startsWith('### ') ? 3 : 2, text = line.slice(level + 1);
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].slice(1, -1).split(' | ').map((c) => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(```|#|\||- |\d+\. )/.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/** Removes editor notes ("%% " lines). */
export const strip = (md) => md.split('\n').filter((l) => !l.startsWith('%% ')).join('\n');

/**
 * One hairline drawing (Rafa, 2026-11-01): two agents, the escrow, one adjudicator GPU and the bond
 * capital behind it, cycling through four outcomes. Complete at rest (sheet 01 drawn); motion is extra.
 */
const GPU = (x, i, name) => `<g class="gpu" id="g${i}" transform="translate(${x} 214)">
<rect x="-22" y="-22" width="44" height="44"/><rect x="-11" y="-11" width="22" height="22"/>
<path d="M-14 -22v-6M-5 -22v-6M5 -22v-6M14 -22v-6M-14 22v6M-5 22v6M5 22v6M14 22v6M-22 -14h-6M-22 -5h-6M-22 5h-6M-22 14h-6M22 -14h6M22 -5h6M22 5h6M22 14h6"/>
<text y="44">${name}</text></g>`;
// The figures are period engravings with the paper lifted off (brand/sketch/lift.mjs); sources in site/llms.txt.
// The agents: Vaucanson's tambourine player, an 18th-century automaton; the seller is the same figure mirrored.
const AGENT = `<!-- Agents: Vaucanson's automaton tambourine player, 18th-century engraving reproduced in H.-R. d'Allemagne, "Histoire des jouets" (1902); public domain. https://commons.wikimedia.org/wiki/File:Automates_Vaucanson.jpg -->
<image href="${BASE}agent.png" x="49" y="53" width="74" height="94"/><image href="${BASE}agent.png" x="-591" y="53" width="74" height="94" transform="scale(-1 1)"/>`;
// The escrow: an iron strongbox ("Armada chest").
const SAFE = `<!-- Escrow: "A Sixteenth Century Coffre-fort", from F. Litchfield, "Illustrated History of Furniture" (1893); public domain. https://commons.wikimedia.org/wiki/File:A_Sixteenth_Century_Coffre-fort.jpg -->
<image href="${BASE}escrow.png" x="274" y="58" width="92" height="86" opacity="0.85"/>`;
// The bond capital: money bags.
const BOND = `<!-- Bond capital: money bags from José Guadalupe Posada, "A rich man with bags of money at his feet sending people away" (c. 1880-1910), The Met; CC0. https://commons.wikimedia.org/wiki/File:A_rich_man_with_bags_of_money_at_his_feet_sending_people_away_MET_DP869407.jpg -->
<image href="${BASE}bond.png" x="268" y="292" width="104" height="49"/>`;
const FIGURE = `<figure aria-label="Animated drawing: two agents, the escrow, an adjudicator and its bond capital, cycling through release, refund, default and appeal">
<svg viewBox="0 0 640 380" role="img">
<defs><filter id="pencil" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
<g filter="url(#pencil)">
<g class="frame"><rect x="6" y="6" width="628" height="368"/><rect x="11" y="11" width="618" height="358" class="inner"/></g>
<g class="ln"><path d="M116 100H274M366 100H524"/><path d="M320 144V182"/><path d="M320 292V264" stroke-dasharray="2 3"/></g>
${AGENT}
${SAFE}
${BOND}
${GPU(320, 0, 'adjudicator')}
</g>
<g class="lbl"><text x="86" y="162">buyer agent</text><text x="554" y="162">seller agent</text><text x="320" y="53">escrow</text><text x="320" y="356">bond capital</text></g>
<text x="320" y="38" class="note" id="note">Checks pass: the price to the seller, the key to the buyer, in one step.</text>
<text x="24" y="358" class="cap k" id="sh">Plate I of IV</text><text x="616" y="358" class="cap" id="cap" style="text-anchor:end">Release</text>
<g id="tokens"></g>
</svg></figure>
<script>
(function () {
  // tokens leave and arrive at the agents' sides, where the lines meet them, not on their faces
  var P = { b: [116, 100], s: [524, 100], e: [320, 100], g0: [320, 214], k: [320, 317] };
  var S = [
    { cap: 'Release', note: 'Checks pass: the price to the seller, the key to the buyer, in one step.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 's', 2900], ['k', 'e', 'b', 2900]] },
    { cap: 'Refund', note: 'A required check fails: the price goes back to the buyer.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 'b', 2900]] },
    { cap: 'Default', note: 'The adjudicator stays silent past its deadline: the buyer is refunded, the seller paid from the bond.', on: -1, off: 0,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['$', 'e', 'b', 2600], ['$', 'k', 's', 2900]] },
    { cap: 'Appeal', note: 'An appeal overturns the decision: the bond pays the wronged party.', on: 0, off: -1,
      m: [['$', 'b', 'e', 0], ['w', 's', 'e', 700], ['w', 'e', 'g0', 1500], ['$', 'e', 's', 2600], ['w', 'b', 'g0', 3300], ['$', 'k', 'b', 4300]] }
  ];
  // The case study's code (examples/buy-dataset.ts: a buyer agent buys a cleaned customers.csv for 25 tUSD from a
  // seller agent), typed faintly down the page: the buyer's code on the left, the seller's on the right, each
  // with its call results as comments. Same delays as the plate. Each line is [delay ms, 'b' | 's', text].
  var hex = function (n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
  var K = 2.2; // one pace for the tokens and both code streams: a plate lasts about 13.6 s
  var CALLS = function (i, id) {
    var open = [
      [0, 'b', "const me = { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey };"],
      [80, 'b', "await mail(seller, me); // ask for an offer: customers.csv, at most 30 tUSD"],
      [0, 's', "const offer = await seller.offer({"],
      [60, 's', "  template: 'checks-only', price: { token: 'tUSD', amount: '25000000' },"],
      [120, 's', "  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },"],
      [180, 's', "  checks: [cols, rows, uniq], buyer: me, adjudicators: { primary, fallback, appeal },"],
      [240, 's', "}); // \\u2192 offer " + id + ": Offered"],
      [300, 's', "await mail(buyer, offer.terms);"],
      [320, 'b', "await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);"],
      [420, 'b', "const held = await buyer.agreeAndFund(offer.terms, 30_000_000n);"],
      [520, 'b', "// verify domain, price, nonces \\u00b7 sign Agree + FundingAuthorization"],
      [600, 'b', "// \\u2192 Held, 26000000 base units (price + fee)"],
      [620, 's', "await seller.waitFor(offer.id, ['Held']); // \\u2192 Held"],
      [700, 's', "await seller.deliver(offer.terms, new TextEncoder().encode(csv));"],
      [820, 's', "// AES-256-GCM \\u00b7 key sealed to 3 adjudicators + buyer \\u00b7 sign Delivery"],
      [1100, 's', "// \\u2192 Delivered"]
    ];
    var tail = [
      [ // release
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \\u2713 rows \\u2713 uniq \\u2713 \\u2192 accept"],
        [2900, 'b', "// \\u2192 Released: the content key is mine"],
        [2900, 's', "// \\u2192 Released: 25000000 tUSD paid to me"],
        [3300, 'b', "const work = await buyer.openDelivery(offer.id); // open envelope, check sha256"],
        [3600, 'b', "// customer_id,email \\u00b7 1,ada@example.com \\u00b7 2,alan@\\u2026"],
        [4300, 'b', "await balance(buyer); // \\u2192 9974000000"],
        [4300, 's', "await balance(seller); // \\u2192 10025000000"]
      ],
      [ // refund
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \\u2713 rows \\u2717 (2 of 3) uniq \\u2713 \\u2192 reject"],
        [2900, 'b', "// \\u2192 Refunded: 25000000 tUSD back to me (the 1 tUSD fee is spent)"],
        [2900, 's', "// \\u2192 Refunded: unpaid, and the buyer never got the key"],
        [4300, 'b', "await balance(buyer); // \\u2192 9999000000"]
      ],
      [ // default
        [1500, 'b', "// judgeBy passes with no decision from the adjudicator"],
        [1500, 's', "// judgeBy passes with no decision from the adjudicator"],
        [2200, 'b', "await buyer.call('POST', '/v1/commitments/' + offer.id + '/triggers/default');"],
        [2350, 'b', "// \\u2192 Defaulted"],
        [2600, 's', "await seller.call('POST', '/v1/commitments/' + offer.id + '/triggers/apply-default');"],
        [2900, 'b', "// \\u2192 refunded: 25000000 tUSD back to me"],
        [2900, 's', "// \\u2192 compensated from the adjudicator's bond"]
      ],
      [ // appeal
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator \\u2192 accept: but the rows fail the terms"],
        [2600, 's', "// \\u2192 Released: 25000000 tUSD paid to me"],
        [3300, 'b', "const p = await buyer.call('POST', '/v1/prepare/appeal', { commitmentId: offer.id, appellant: buyer.address });"],
        [3450, 'b', "await buyer.signAndSubmit(p, { kind: 'appeal', terms: offer.terms }); // bond 5% + fee"],
        [3600, 'b', "// \\u2192 appealState: open"],
        [3600, 's', "// appeal filed by the buyer \\u00b7 appealState: open"],
        [4200, 'b', "// appeal adjudicator \\u2192 overturned"],
        [4350, 'b', "// \\u2192 the bond pays me 25000000 tUSD"],
        [4350, 's', "// appeal overturned: the bond pays the buyer"]
      ]
    ][i];
    // the agents asking the API about itself, spread over the four plates so every feature shows once
    var c = "'/v1/commitments/' + offer.id + '";
    var QA = [
      [ // plate I
        [4500, 'b', "// which adjudicators can we name, and what do they charge?"],
        [4620, 'b', "await buyer.call('GET', '/v1/adjudicators'); // \\u2192 3 \\u00b7 fee.min 1 tUSD \\u00b7 bonded"],
        [4500, 's', "// does every operator serve the same record?"],
        [4620, 's', "await seller.call('GET', " + c + "/events'); // \\u2192 same hashes on op-1 and op-2"],
        [5200, 'b', "// what did the seller actually sign?"],
        [5320, 'b', "await buyer.call('GET', " + c + "/terms'); // \\u2192 matches the mailed offer"],
        [5200, 's', "// a fresh agent? the faucet funds it and admits it to the club"],
        [5320, 's', "await fresh.call('POST', '/v1/faucet', { address }); // \\u2192 1000 tUSD \\u00b7 demo-club"]
      ],
      [ // plate II
        [4500, 'b', "// what exactly did the checks find?"],
        [4620, 'b', "await buyer.call('GET', " + c + "/judgment'); // \\u2192 rows: 2, terms say 3"],
        [4500, 's', "// can I preview a submit before signing it?"],
        [4620, 's', "await seller.call('POST', " + c + "/deliveries?validateOnly=true', draft); // \\u2192 200, nothing changed"],
        [5200, 's', "// who must the content key be sealed to?"],
        [5320, 's', "await seller.call('GET', " + c + "/recipients'); // \\u2192 primary, fallback, appeal, buyer"]
      ],
      [ // plate III
        [4500, 'b', "// what does the club's rulebook say a default pays?"],
        [4620, 'b', "await buyer.call('GET', '/v1/clubs/demo-club'); // \\u2192 refund buyer, compensate seller"],
        [4500, 's', "// what can this API do?"],
        [4620, 's', "await seller.call('GET', '/v1/openapi.json'); // \\u2192 OpenAPI 3.1, every route"],
        [5200, 's', "// which settlement layer is this, and what time is it there?"],
        [5320, 's', "await seller.call('GET', '/.well-known/holdback.json'); // \\u2192 domain, settlementTime"]
      ],
      [ // plate IV
        [2700, 'b', "// what would an appeal cost?"],
        [2820, 'b', "await buyer.call('GET', '/v1/clubs/demo-club'); // \\u2192 appealBondRateBps 500 \\u00b7 appealFee 25 tUSD"],
        [4800, 's', "// where are my receipts?"],
        [4920, 's', "await seller.call('GET', " + c + "/receipts'); // \\u2192 signed by each operator"],
        [5000, 'b', "// what do I hold now?"],
        [5120, 'b', "await buyer.call('GET', '/v1/balances/' + buyer.address); // \\u2192 the bond's 25 tUSD arrived"]
      ]
    ][i];
    return open.concat(tail, QA);
  };
  var streams = { b: document.getElementById('stream-b'), s: document.getElementById('stream-s') }, streamTimers = [];
  function say(side, text) {
    var el = streams[side];
    if (!el) return;
    var line = document.createElement('div'); line.textContent = text; el.appendChild(line);
    while (el.childNodes.length > 90) el.removeChild(el.firstChild);
  }
  function play(i) {
    streamTimers.forEach(clearTimeout); streamTimers = [];
    var id = '0x' + hex(6) + '\\u2026' + hex(4);
    var calls = CALLS(i, id);
    if (reduce) { calls.forEach(function (l) { say(l[1], l[2]); }); return; }
    var head = ' \\u00b7 plate ' + ['i', 'ii', 'iii', 'iv'][i] + ', ' + S[i].cap.toLowerCase();
    say('b', ''); say('b', '// buyer agent' + head);
    say('s', ''); say('s', '// seller agent' + head);
    calls.forEach(function (l) { streamTimers.push(setTimeout(function () { say(l[1], l[2]); }, l[0] * K)); });
  }
  var NS = 'http://www.w3.org/2000/svg', T = document.getElementById('tokens');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mk(kind) {
    var el = document.createElementNS(NS, kind === 'w' ? 'rect' : 'circle');
    if (kind === 'w') { el.setAttribute('width', 8); el.setAttribute('height', 8); el.setAttribute('x', -4); el.setAttribute('y', -4); el.setAttribute('class', 'tw'); }
    else { el.setAttribute('r', 4); el.setAttribute('class', kind === 'k' ? 'tk' : 'tm'); }
    T.appendChild(el); return el;
  }
  function show(i) {
    var s = S[i];
    document.getElementById('sh').textContent = 'Plate ' + ['I', 'II', 'III', 'IV'][i] + ' of IV';
    document.getElementById('cap').textContent = s.cap;
    document.getElementById('note').textContent = s.note;
    for (var g = 0; g < 1; g++) {
      var c = document.getElementById('g' + g).classList;
      c.toggle('on', g === s.on); c.toggle('off', g === s.off);
    }
    T.textContent = '';
    play(i);
    var items = s.m.map(function (m) { return { kind: m[0], a: P[m[1]], b: P[m[2]], t0: m[3] * K, el: mk(m[0]) }; });
    if (reduce) { items.forEach(function (it) { it.el.setAttribute('transform', 'translate(' + it.b + ')'); }); return; }
    var start = performance.now();
    (function tick(now) {
      var live = false;
      items.forEach(function (it) {
        var t = (now - start - it.t0) / (900 * K * 0.8);
        if (t < 0) { it.el.style.opacity = 0; live = true; return; }
        t = Math.min(1, t); var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        it.el.style.opacity = 1;
        it.el.setAttribute('transform', 'translate(' + (it.a[0] + (it.b[0] - it.a[0]) * e) + ' ' + (it.a[1] + (it.b[1] - it.a[1]) * e) + ')');
        if (t < 1) live = true;
      });
      if (live) requestAnimationFrame(tick);
    })(start);
  }
  var i = 0; show(0);
  if (!reduce) setInterval(function () { i = (i + 1) % S.length; show(i); }, 6200 * K);
})();
</script>`;

// Try ’crow: a single prompt for any agent, and the early-access request (a drawer on phones). Sign-ups go to
// the crow-early-access Worker (apps/early-access), which keeps only the address, the time and the page.
// One line: the instructions live in llms.txt ("Try it"), not in the prompt.
const PROMPT = `Read ${SITE_URL}llms.txt and run a test deal with ’crow.`;
const TRY = `<section class="try" aria-label="Try ’crow">
<div class="cta"><button class="btn primary" id="copy" type="button">Try ’crow</button><button class="btn" id="join-open" type="button">Request early access</button></div>
<p class="copied" id="copied" role="status" hidden>Prompt copied: <span id="prompt">“${esc(PROMPT)}”</span></p>
</section>`;
const JOIN = `<dialog id="join" aria-label="Request early access">
<button class="x" id="join-close" type="button" aria-label="Close">×</button>
<form id="join-form" novalidate>
<input id="join-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" aria-label="Email">
<input class="hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn primary" id="join-send" type="submit">Request access</button>
<p class="msg" id="join-msg" role="status"></p>
</form>
</dialog>
<script>
(function () {
  // Try ’crow: copy the one-line prompt and say so on one line below the buttons
  var copy = document.getElementById('copy'), line = document.getElementById('copied'), prompt = document.getElementById('prompt');
  var text = prompt.textContent.replace(/^\\u201c|\\u201d$/g, '');
  copy.addEventListener('click', function () {
    var show = function (lead) { line.firstChild.textContent = lead; line.hidden = false; };
    var select = function () { show('Copy this prompt: '); var r = document.createRange(); r.selectNodeContents(prompt); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { show('Prompt copied: '); }, select); else select();
  });
  var dlg = document.getElementById('join'), form = document.getElementById('join-form'), msg = document.getElementById('join-msg'), send = document.getElementById('join-send');
  document.getElementById('join-open').addEventListener('click', function () { msg.textContent = ''; if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); document.getElementById('join-email').focus(); });
  document.getElementById('join-close').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) { msg.textContent = 'Please enter a full email address, like you@example.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('https://join.escrow.stream/early-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + email + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) form.email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through. Check your connection and try again.'; })
      .then(function () { send.disabled = false; });
  });
})();
</script>`;

/**
 * index.html from llms.txt: the tagline as a title and a subtitle, and the drawing (Rafa, 2026-11-01: the
 * page says "escrow for agents" and a descriptive subtitle; every doc lives in llms.txt). Agents find the
 * docs through the <link rel="alternate"> in the head.
 */
export function page(md) {
  const tagline = /^> (.+)$/m.exec(strip(md))[1];
  const cut = tagline.indexOf('. ') + 1, title = tagline.slice(0, cut - 1), subtitle = tagline.slice(cut).trim();
  // the first paragraph after the tagline is the page's one paragraph
  const src = strip(md), after = src.slice(src.indexOf(tagline) + tagline.length).trim();
  const intro = after.slice(0, after.indexOf('\n\n')).trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="${BASE}favicon.png">
<link rel="apple-touch-icon" href="${BASE}favicon.png">
<meta name="description" content="${esc(tagline)}">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${BASE}llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<style>
/* A naturalist's notebook, to sit with Thorburn's 1919 study: laid paper, graphite, a book face of the period, sepia for the one accent. */
:root { color-scheme: light; --paper: #faf7f0; --graphite: #2f2d2a; --pencil: #57534c; --faint: #8f897e; --sepia: #8a6237; --serif: "EB Garamond", Garamond, "Times New Roman", serif; }
body { margin: 0; background: var(--paper); color: var(--graphite); font-family: var(--serif); text-align: center; }
main { position: relative; z-index: 1; margin: 0 auto; padding: 9vh max(24px, env(safe-area-inset-left, 0px)) 72px; max-width: 720px; }
/* the agents' code: faint terminal text down each side (buyer left, seller right), misting out at the edges */
.stream { position: fixed; z-index: 0; top: 0; bottom: 0; width: calc((100vw - 720px) / 2 + 40px); max-width: 460px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; pointer-events: none; user-select: none;
  font: 10.5px/1.7 ui-monospace, "SF Mono", Menlo, monospace; color: var(--faint); opacity: .6; text-align: left; white-space: pre; }
#stream-b { left: 0; padding: 0 12px 14vh max(20px, env(safe-area-inset-left, 0px));
  -webkit-mask-image: radial-gradient(ellipse 95% 70% at 35% 62%, #000 25%, transparent 78%); mask-image: radial-gradient(ellipse 95% 70% at 35% 62%, #000 25%, transparent 78%); }
#stream-s { right: 0; padding: 0 max(20px, env(safe-area-inset-right, 0px)) 14vh 12px;
  -webkit-mask-image: radial-gradient(ellipse 95% 70% at 65% 62%, #000 25%, transparent 78%); mask-image: radial-gradient(ellipse 95% 70% at 65% 62%, #000 25%, transparent 78%); }
.stream div { overflow: hidden; flex-shrink: 0; min-height: 1.7em; } /* never squeeze lines when the stream is full */
@media (max-width: 1100px) { .stream { width: 50%; opacity: .16; } }
.mark { display: block; margin: 0 auto 12px; width: min(320px, 72vw); height: auto; }
h1 { font-family: var(--serif); font-size: clamp(56px, 12vw, 96px); line-height: 1; letter-spacing: -0.01em; font-weight: 500; margin: 0 0 10px; }
.sub { font-style: italic; font-size: clamp(20px, 4vw, 26px); color: var(--pencil); margin: 0 0 28px; }
.intro { font-size: clamp(18px, 2.6vw, 20px); line-height: 1.55; color: var(--graphite); max-width: 34em; margin: 0 auto; text-wrap: pretty; }
figure { margin: 56px auto 0; max-width: 640px; }
svg { width: 100%; height: auto; display: block; }
svg path, svg rect { fill: none; stroke: var(--pencil); stroke-width: 0.9; stroke-linecap: round; stroke-linejoin: round; }
.frame rect { stroke: var(--pencil); stroke-width: 0.8; } .frame .inner { stroke: var(--faint); stroke-width: 0.5; }
.ln path { stroke: var(--faint); stroke-width: 0.7; }
svg text { font-family: var(--serif); font-size: 11px; font-variant: small-caps; letter-spacing: 0.06em; fill: var(--graphite); text-anchor: middle; }
.cap { font-style: italic; font-variant: normal; letter-spacing: 0; text-anchor: start; }
.cap.k { fill: var(--faint); font-size: 10.5px; }
text.note { text-anchor: middle; font-style: italic; font-variant: normal; letter-spacing: 0; fill: var(--pencil); font-size: 11.5px; }
.gpu { transition: opacity .4s; } .gpu text { fill: var(--pencil); font-size: 10.5px; }
.gpu.on rect, .gpu.on path { stroke: var(--sepia); stroke-width: 1.3; } .gpu.on text { fill: var(--sepia); }
.gpu.off { opacity: .3; } .gpu.off rect { stroke-dasharray: 2 3; }
.tm { fill: var(--graphite); stroke: none; } .tk { fill: var(--paper); stroke: var(--sepia); stroke-width: 1.4; } .tw { fill: var(--paper); stroke: var(--graphite); stroke-width: 1; }
/* Try ’crow: one prompt to paste into an agent; and the early-access request */
.try { margin: 36px auto 0; max-width: 36em; }
.copied { margin: 16px 0 0; font-size: 16px; font-style: italic; color: var(--pencil); overflow-wrap: anywhere; }
.copied span { font-style: normal; color: var(--graphite); }
.btn { font: 16px var(--serif); color: var(--graphite); background: transparent; border: 1px solid var(--graphite); border-radius: 999px; padding: 8px 18px; cursor: pointer; }
.btn:hover { background: #efe9dc; } .btn:focus-visible, input:focus-visible { outline: 2px solid var(--sepia); outline-offset: 2px; }
.btn.primary { background: var(--graphite); color: var(--paper); } .btn.primary:hover { background: #45423d; }
.cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
dialog { box-sizing: border-box; border: 1px solid #d8d2c4; border-radius: 12px; padding: 28px; width: min(420px, calc(100% - 32px)); background: var(--paper); color: var(--graphite); font-family: var(--serif); text-align: left; box-shadow: 0 20px 60px rgba(47, 45, 42, .18); }
dialog::backdrop { background: rgba(47, 45, 42, .28); }
dialog { padding-top: 44px; }
dialog form { display: flex; gap: 10px; flex-wrap: wrap; }
dialog input[type=email] { flex: 1 1 200px; min-width: 0; box-sizing: border-box; font: 18px var(--serif); color: var(--graphite); background: #fffdf8; border: 1px solid #cfc8b8; border-radius: 999px; padding: 9px 16px; }
dialog .x { position: absolute; top: 8px; right: 10px; width: 36px; height: 36px; border: 0; background: transparent; font: 26px/1 var(--serif); color: var(--pencil); cursor: pointer; border-radius: 50%; }
dialog .x:hover { background: #efe9dc; } dialog .x:focus-visible { outline: 2px solid var(--sepia); outline-offset: 2px; }
dialog .msg { flex-basis: 100%; margin: 4px 0 0; color: var(--pencil); font-size: 16px; font-style: italic; }
dialog .msg:empty { display: none; }
.hp { position: absolute; left: -10000px; width: 1px; height: 1px; opacity: 0; }
/* on phones the request slides up as a drawer from the bottom */
@media (max-width: 640px) {
  dialog { margin: auto 0 0; width: 100%; max-width: none; border-radius: 16px 16px 0 0; border-bottom: 0; padding: 52px max(20px, env(safe-area-inset-left, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)); }
  dialog[open] { animation: drawer .26s ease-out; }
  @keyframes drawer { from { transform: translateY(100%); } }
}
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
</style>
</head>
<body>
<div id="stream-b" class="stream" aria-hidden="true"></div>
<div id="stream-s" class="stream" aria-hidden="true"></div>
<main>
<!-- Hooded crow: Archibald Thorburn, "A naturalist's sketch book" (1919), plate 18, public domain. -->
<img class="mark" src="${BASE}crow.png" alt="A pencil study of a hooded crow by Archibald Thorburn, 1919" width="640" height="406">
<h1>${inline(title)}</h1>
<p class="sub">${inline(subtitle)}</p>
<p class="intro">${inline(intro)}</p>
${TRY}
${FIGURE}
</main>
${JOIN}
</body>
</html>
`;
}

/** The published files: placeholders filled, editor notes gone. */
export function filled(md, { op1, op2 }) {
  if (/^%% CONFIRM/m.test(md)) throw new Error('llms.txt still has "%% CONFIRM" notes: check each against the deployed API, fix the text, delete the note, then build again');
  const ok = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+$/.test(u);
  if (!ok(op1) || !ok(op2)) throw new Error('--op1 and --op2 are https origins with no path and no trailing slash, e.g. https://holdback-op1.example.workers.dev');
  const out = strip(md).replace('{{OP1}}', op1).replace('{{OP2}}', op2);
  if (/\{\{[A-Z0-9]+\}\}/.test(out)) throw new Error('a placeholder is left unfilled');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const md = readFileSync(here('llms.txt'), 'utf8');
  const out = arg('out');
  if (!out) {
    writeFileSync(here('index.html'), page(md));
    console.log('wrote site/index.html');
  } else {
    const txt = filled(md, { op1: arg('op1'), op2: arg('op2') });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'llms.txt'), txt);
    writeFileSync(join(out, 'index.html'), page(txt));
    for (const f of ['crow.png', 'favicon.png', 'agent.png', 'escrow.png', 'bond.png']) writeFileSync(join(out, f), readFileSync(here(f)));
    console.log(`wrote ${join(out, 'llms.txt')} and ${join(out, 'index.html')}: publish both under ${SITE_URL}`);
  }
}
