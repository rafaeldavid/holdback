// Preloaded into each client command a duet agent runs (node --import), T-391: it writes one JSON line per HTTP call
// the command makes (the method, the origin and path, the status, the time) to the file DUET_FETCH_LOG names, so the
// record has every API call with its status. No header, no query string and no body is written. It changes nothing
// the command sends or receives: the command talks to the real operators, whose origins its own checks pin.
import { appendFileSync } from 'node:fs';

const file = process.env.DUET_FETCH_LOG;
const original = globalThis.fetch;
if (file && typeof original === 'function') {
  globalThis.fetch = async function logged(input, init) {
    const started = Date.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let where = '';
    try {
      const u = new URL(input instanceof Request ? input.url : String(input));
      where = `${u.origin}${u.pathname}`;
    } catch {
      where = 'unparsed';
    }
    const line = (status) => {
      try { appendFileSync(file, `${JSON.stringify({ at: started, method, url: where, status, ms: Date.now() - started })}\n`); } catch { /* the log is best effort */ }
    };
    try {
      const res = await original(input, init);
      line(res.status);
      return res;
    } catch (e) {
      line(0);
      throw e;
    }
  };
}
