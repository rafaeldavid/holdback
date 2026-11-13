(function () {
  // The headline shows its three lines in turn ("Sell to any agent.", "Buy from any agent.", "Go direct."), every
  // 3.5 s, and holds while hovered. It stays on the first for a visitor who asks for reduced motion; screen readers
  // read all of it from the .sr line. Only the line on show takes room, so each stays centred. At a swap the line is set
  // back where it stood, then let go, so it glides to its new centre in 0.45 s and nothing jumps.
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var h = document.querySelector('h1'), line = h.querySelector('.line'), slot = h.querySelector('.verb'), v = slot.querySelectorAll('.v'), i = 0, t;
  var swap = function () {
    var was = slot.getBoundingClientRect().right;
    v[i].classList.remove('on'); i = (i + 1) % v.length; v[i].classList.add('on');
    line.style.transition = 'none'; line.style.transform = 'translateX(' + (was - slot.getBoundingClientRect().right) + 'px)';
    line.getBoundingClientRect(); // the line now stands where it stood
    line.style.transition = ''; line.style.transform = '';
  };
  if (!still) {
    var start = function () { clearInterval(t); t = setInterval(swap, 3500); };
    h.addEventListener('mouseenter', function () { clearInterval(t); });
    h.addEventListener('mouseleave', start);
    start();
  }
  // The case study's code (examples/buy-dataset.ts: a buyer agent buys a cleaned customers.csv for 25 tUSDC from a
  // seller agent), typed faintly down the page: the buyer's code on the left, the seller's on the right, each
  // with its call results as comments. New lines arrive at the bottom and push older ones up. Each line is
  // [delay ms, 'b' | 's', text], the delay scaled by K; a new deal starts every 6200 ms × K, about 13.6 s.
  var hex = function (n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
  var K = 2.2; // one pace for both streams
  var CALLS = function (i, id) {
    var open = [
      [0, 'b', "const me = { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey };"],
      [80, 'b', "await mail(seller, me); // ask for an offer: customers.csv, at most 30 tUSDC"],
      [0, 's', "const offer = await seller.offer({"],
      [60, 's', "  template: 'checks-only', price: { token: TUSDC, amount: '25000000' },"],
      [120, 's', "  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },"],
      [180, 's', "  checks: [cols, rows, uniq], buyer: me, adjudicators: { primary, fallback, appeal },"],
      [240, 's', "}); // \u2192 offer " + id + ": Offered"],
      [300, 's', "await mail(buyer, offer.terms);"],
      [320, 'b', "await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);"],
      [420, 'b', "const held = await buyer.agreeAndFund(offer.terms, 30_000_000n);"],
      [520, 'b', "// verify domain, price, nonces \u00b7 sign Agree + FundingAuthorization"],
      [600, 'b', "// \u2192 Held, 26000000 base units (price + fee)"],
      [620, 's', "await seller.waitFor(offer.id, ['Held']); // \u2192 Held"],
      [700, 's', "await seller.deliver(offer.terms, new TextEncoder().encode(csv));"],
      [820, 's', "// AES-256-GCM \u00b7 key sealed to 3 adjudicators + buyer \u00b7 sign Delivery"],
      [1100, 's', "// \u2192 Delivered"]
    ];
    var tail = [
      [ // release
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \u2713 rows \u2713 uniq \u2713 \u2192 accept"],
        [2900, 'b', "// \u2192 Released: the content key is mine"],
        [2900, 's', "// \u2192 Released: 25000000 tUSDC paid to me"],
        [3300, 'b', "const work = await buyer.openDelivery(offer.id); // open envelope, check sha256"],
        [3600, 'b', "// customer_id,email \u00b7 1,ada@example.com \u00b7 2,alan@\u2026"],
        [4300, 'b', "await balance(buyer); // \u2192 9974000000"],
        [4300, 's', "await balance(seller); // \u2192 10025000000"]
      ],
      [ // refund
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \u2713 rows \u2717 (2 of 3) uniq \u2713 \u2192 reject"],
        [2900, 'b', "// \u2192 Refunded: 25000000 tUSDC back to me (the 1 tUSDC fee is spent)"],
        [2900, 's', "// \u2192 Refunded: unpaid, and the buyer never got the key"],
        [4300, 'b', "await balance(buyer); // \u2192 9999000000"]
      ],
      [ // default
        [1500, 'b', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [1500, 's', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [2200, 'b', "await buyer.call('POST', '/v1/commitments/' + offer.id + '/triggers/default');"],
        [2350, 'b', "// \u2192 Defaulted, then Refunded in the same transaction"],
        [2600, 's', "await seller.waitFor(offer.id, ['Refunded']);"],
        [2900, 'b', "// \u2192 refunded: 25000000 tUSDC and the 1 tUSDC fee back to me"],
        [2900, 's', "// \u2192 no decision, so the default outcome: the buyer's money goes back"]
      ],
      [ // escalation
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// primary adjudicator: the screen flags the work \u2192 escalate"],
        [2600, 's', "// \u2192 Escalated: the appeal adjudicator decides within appealDecideSec"],
        [3300, 'b', "// the drand round after the escalation's block seeds a fresh panel"],
        [4200, 'b', "// appeal adjudicator: rows \u2717 (2 of 3) \u2192 reject \u00b7 final"],
        [4350, 'b', "// \u2192 Refunded: 25000000 tUSDC back to me"],
        [4350, 's', "// \u2192 Refunded: the decision is final when it settles"]
      ]
    ][i];
    // the agents asking the API about itself, spread over the four deals so every feature shows once
    var c = "'/v1/commitments/' + offer.id + '";
    var QA = [
      [ // release
        [4500, 'b', "// which adjudicators can we name, and what do they charge?"],
        [4620, 'b', "await buyer.call('GET', '/v1/adjudicators'); // \u2192 3 \u00b7 fee.min 1 tUSDC"],
        [4500, 's', "// does every operator serve the same record?"],
        [4620, 's', "await seller.call('GET', " + c + "/events'); // \u2192 same hashes on op-1 and op-2"],
        [5200, 'b', "// what did the seller actually sign?"],
        [5320, 'b', "await buyer.call('GET', " + c + "/terms'); // \u2192 matches the mailed offer"],
        [5200, 's', "// a fresh agent? the faucet funds it and admits it to the club"],
        [5320, 's', "await fresh.call('POST', '/v1/faucet', { address }); // \u2192 1000 tUSDC \u00b7 demo-club"]
      ],
      [ // refund
        [4500, 'b', "// what exactly did the checks find?"],
        [4620, 'b', "await buyer.call('GET', " + c + "/judgment'); // \u2192 rows: 2, terms say 3"],
        [4500, 's', "// can I preview a submit before signing it?"],
        [4620, 's', "await seller.call('POST', " + c + "/deliveries?validateOnly=true', draft); // \u2192 200, nothing changed"],
        [5200, 's', "// who must the content key be sealed to?"],
        [5320, 's', "await seller.call('GET', " + c + "/recipients'); // \u2192 primary, fallback, appeal, buyer"]
      ],
      [ // default
        [4500, 'b', "// what does the club's rulebook say a default pays?"],
        [4620, 'b', "await buyer.call('GET', '/v1/clubs/demo-club'); // \u2192 the default outcome: refund the buyer"],
        [4500, 's', "// what can this API do?"],
        [4620, 's', "await seller.call('GET', '/v1/openapi.json'); // \u2192 OpenAPI 3.1, every route"],
        [5200, 's', "// which settlement layer is this, and what time is it there?"],
        [5320, 's', "await seller.call('GET', '/.well-known/holdback.json'); // \u2192 domain, settlementTime"]
      ],
      [ // escalation
        [2700, 'b', "// who decides now, and by when?"],
        [2820, 'b', "await buyer.call('GET', " + c + "'); // \u2192 escrowState: Escalated \u00b7 the appeal adjudicator's turn"],
        [4800, 's', "// where are my receipts?"],
        [4920, 's', "await seller.call('GET', " + c + "/receipts'); // \u2192 signed by each operator"],
        [5000, 'b', "// what do I hold now?"],
        [5120, 'b', "await buyer.call('GET', '/v1/balances/' + buyer.address); // \u2192 the 25 tUSDC price is back"]
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
    var id = '0x' + hex(6) + '\u2026' + hex(4);
    var calls = CALLS(i, id);
    if (still) { calls.forEach(function (l) { say(l[1], l[2]); }); return; }
    var head = ' \u00b7 ' + ['release', 'refund', 'default', 'escalation'][i];
    say('b', ''); say('b', '// buyer agent' + head);
    say('s', ''); say('s', '// seller agent' + head);
    calls.forEach(function (l) { streamTimers.push(setTimeout(function () { say(l[1], l[2]); }, l[0] * K)); });
  }
  // Four deals in turn, one every 6200 ms × K. A visitor who asks for reduced motion gets the first deal's code
  // written once, with no animation.
  var deal = 0; play(0);
  if (!still) setInterval(function () { deal = (deal + 1) % 4; play(deal); }, 6200 * K);
  // Try Crow: the copy icon copies the prompt for the visitor's AI assistant.
  // Where the clipboard is refused, the prompt shows selected instead so the visitor can copy it by hand.
  var select = function (el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  var prompt = document.getElementById('prompt').textContent, tag = document.getElementById('copied');
  var fallback = function () { tag.textContent = '\u201c' + prompt + '\u201d'; select(tag); };
  document.getElementById('copy').addEventListener('click', function () {
    var done = function () { tag.textContent = 'Copied'; setTimeout(function () { tag.textContent = ''; }, 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(prompt).then(done, fallback); else fallback();
  });
  // early access: the email form sits on the page
  var form = document.getElementById('join-form'), msg = document.getElementById('join-msg'), send = document.getElementById('join-send');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Please enter a full email address, like you@example.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('https://join.crow.direct/early-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + email + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) form.email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through. Check your connection and try again.'; })
      .then(function () { send.disabled = false; });
  });
})();
