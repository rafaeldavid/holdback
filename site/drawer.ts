// The early-access form (Rafa, 2026-11-13): a centred pop-up on desktop, a bottom sheet on a phone (T-400). One
// source; the demo page (tools/duet/replay.ts) writes it inline, so that page stays one self-contained file, and the
// home page's form posts to the same JOIN_URL.
//
// A control opens it when it carries data-join and is a link to a visible sign-up form, so a visitor with scripts off
// still reaches a form: the home page's #join-form, or that form from the demo page. The script builds the drawer
// itself, so a page carries no extra markup for it. It posts to the home page's sign-up service with the home page's
// fields: no new endpoint and no new data. It takes focus when it opens; Escape and a click outside close it; focus
// returns to the control that opened it. Its look is the kit's dialog (site/brand/), on both pages.

import { button, dialog } from './brand/kit.mjs';

/** The sign-up service: the home page's form posts here, and so does the drawer. */
export const JOIN_URL = 'https://join.crow.direct/early-access';

/** The drawer: the kit's dialog (site/brand/, T-402) holding the early-access form, built once here. */
const DRAWER_HTML = dialog({
  id: 'join-drawer',
  titleId: 'drawer-title',
  title: 'Request early access',
  formHtml: '<p class="ck-dialog-lede">Crow is in early access on test money. Leave your work email and we will write when your team can start.</p>'
    + '<label class="ck-dialog-label" for="drawer-email">Work email</label>'
    + '<input id="drawer-email" name="email" type="email" autocomplete="email" required placeholder="you@company.com">'
    + '<input class="ck-hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + button({ label: 'Request early access', type: 'submit' })
    + '<p class="ck-dialog-msg" role="status"></p>',
});

/** The drawer's script, plain ES5 in its own function: it does nothing on a page with no data-join control. */
export const drawerScript = (): string => String.raw`(function () {
  var opens = document.querySelectorAll('[data-join]');
  if (!opens.length || typeof HTMLDialogElement !== 'function') return; // the controls stay links to a visible form
  var box = document.createElement('div');
  box.innerHTML = ${JSON.stringify(DRAWER_HTML)};
  var d = box.firstChild;
  document.body.appendChild(d);
  var form = d.querySelector('form'), email = d.querySelector('#drawer-email'), msg = d.querySelector('.ck-dialog-msg'), send = d.querySelector('.ck-btn'), opener = null;
  var open = function (e) { e.preventDefault(); e.stopPropagation(); opener = this; msg.textContent = ''; d.showModal(); email.focus(); };
  for (var i = 0; i < opens.length; i++) opens[i].addEventListener('click', open);
  d.querySelector('.ck-dialog-close').addEventListener('click', function () { d.close(); });
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
