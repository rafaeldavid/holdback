// The early-access form (Rafa, 2026-11-13): a centred pop-up on desktop, a bottom sheet on a phone (T-400). One
// source; the demo page (tools/duet/replay.ts) writes it inline, so that page stays one self-contained file, and the
// home page's form posts to the same JOIN_URL.
//
// A control opens it when it carries data-join and is a link to a visible sign-up form, so a visitor with scripts off
// still reaches a form: the home page's #join-form, or that form from the demo page. The script builds the drawer
// itself, so a page carries no extra markup for it. It posts to the home page's sign-up service with the home page's
// fields: no new endpoint and no new data. It takes focus when it opens; Escape and a click outside close it; focus
// returns to the control that opened it. Light only, with its own colours, so it looks the same on both pages.

/** The sign-up service: the home page's form posts here, and so does the drawer. */
export const JOIN_URL = 'https://join.crow.direct/early-access';

export const DRAWER_CSS = `/* the early-access form: a centred pop-up on desktop, a bottom sheet on a phone (site/drawer.ts) */
.drawer { --d-page: #ffffff; --d-ink: #1d1d1f; --d-ink-2: #6e6e73; --d-line: #d2d2d7; --d-hair: rgba(0, 0, 0, .08);
  position: fixed; inset: 0; margin: auto; width: min(440px, calc(100% - 32px)); max-width: 100%; height: fit-content; max-height: calc(100vh - 48px); padding: 0;
  border: 1px solid var(--d-hair); border-radius: 18px; background: var(--d-page); color: var(--d-ink); box-shadow: 0 24px 64px rgba(0, 0, 0, .18);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; }
.drawer::backdrop { background: rgba(0, 0, 0, .28); }
.drawer[open] { animation: drawer-in .24s cubic-bezier(.25, .8, .25, 1); }
@keyframes drawer-in { from { transform: scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
.drawer-form { display: flex; flex-direction: column; gap: 12px; padding: 20px 24px 28px; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.drawer-head h2 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
.drawer-close { width: 32px; height: 32px; padding: 0; border: 1px solid var(--d-line); border-radius: 999px; background: var(--d-page); color: var(--d-ink); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.drawer-close svg { width: 12px; height: 12px; }
.drawer-lede { margin: 0 0 8px; color: var(--d-ink-2); font-size: 15px; line-height: 1.5; }
.drawer-label { font-size: 13px; font-weight: 600; color: var(--d-ink-2); }
.drawer input[type=email] { font: inherit; font-size: 16px; color: var(--d-ink); background: var(--d-page); border: 1px solid var(--d-line); border-radius: 12px; padding: 0 14px; min-height: 48px; }
.drawer-send { font: inherit; font-size: 16px; font-weight: 600; min-height: 48px; margin-top: 4px; border: 0; border-radius: 999px; background: var(--d-ink); color: var(--d-page); cursor: pointer; }
.drawer-send:disabled { opacity: .6; cursor: default; }
.drawer input:focus-visible, .drawer button:focus-visible { outline: 2px solid var(--d-ink); outline-offset: 2px; }
.drawer-msg { margin: 0; font-size: 15px; color: var(--d-ink-2); }
.drawer-msg:empty { display: none; }
.drawer .hp { position: absolute; left: -10000px; width: 1px; height: 1px; opacity: 0; }
@media (max-width: 600px) { .drawer { inset: auto 0 0 0; margin: 0; width: 100%; height: auto; max-height: 90vh; border: 0; border-top: 1px solid var(--d-hair); border-radius: 18px 18px 0 0; box-shadow: 0 -12px 40px rgba(0, 0, 0, .12); } .drawer[open] { animation-name: sheet-in; } }
@keyframes sheet-in { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .drawer[open] { animation: none; } }
`;

/** The drawer's script, plain ES5 in its own function: it does nothing on a page with no data-join control. */
export const drawerScript = (): string => String.raw`(function () {
  var opens = document.querySelectorAll('[data-join]');
  if (!opens.length || typeof HTMLDialogElement !== 'function') return; // the controls stay links to a visible form
  var d = document.createElement('dialog');
  d.className = 'drawer'; d.id = 'join-drawer'; d.setAttribute('aria-labelledby', 'drawer-title');
  d.innerHTML = '<form class="drawer-form" novalidate>'
    + '<div class="drawer-head"><h2 id="drawer-title">Request early access</h2><button class="drawer-close" type="button" aria-label="Close"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></button></div>'
    + '<p class="drawer-lede">Crow is in early access on test money. Leave your work email and we will write when your team can start.</p>'
    + '<label class="drawer-label" for="drawer-email">Work email</label>'
    + '<input id="drawer-email" name="email" type="email" autocomplete="email" required placeholder="you@company.com">'
    + '<input class="hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + '<button class="drawer-send" type="submit">Request early access</button>'
    + '<p class="drawer-msg" role="status"></p></form>';
  document.body.appendChild(d);
  var form = d.querySelector('form'), email = d.querySelector('#drawer-email'), msg = d.querySelector('.drawer-msg'), send = d.querySelector('.drawer-send'), opener = null;
  var open = function (e) { e.preventDefault(); e.stopPropagation(); opener = this; msg.textContent = ''; d.showModal(); email.focus(); };
  for (var i = 0; i < opens.length; i++) opens[i].addEventListener('click', open);
  d.querySelector('.drawer-close').addEventListener('click', function () { d.close(); });
  d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); // a click outside the sheet
  d.addEventListener('close', function () { if (opener) opener.focus(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) { msg.textContent = 'Please enter a full email address, like you@company.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('${JOIN_URL}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + address + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through here. You can also sign up at crow.direct.'; })
      .then(function () { send.disabled = false; });
  });
})();
`;
