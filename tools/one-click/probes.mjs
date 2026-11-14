// How the benchmark harness counts an agent's API calls without changing a response (T-412, from T-328's outsider.mjs):
// - a fetch() probe, preloaded into every Node process the agent starts (`--import`), logs method, origin, path (no
//   query), status and ms;
// - a `curl` wrapper first on the agent's PATH logs each call's arguments and the response status lines.
// The scripted runs use the fetch probe only (their agents are Node scripts); the live runs use both, and a `node`
// wrapper, because Claude Code drops NODE_OPTIONS from its commands' environment (T-328, run s1).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const q1 = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Writes the fetch probe into `dir`; returns its path and its log's path. Paths are written in literally. */
export function writeFetchProbe(dir) {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'fetch.jsonl');
  const path = join(dir, 'fetch-log.mjs');
  writeFileSync(
    path,
    `// Logs each fetch() for a benchmark run (T-412): method, origin, path (no query), status, ms. Responses are unchanged.
import { appendFileSync } from 'node:fs';
const orig = globalThis.fetch;
if (typeof orig === 'function') {
  globalThis.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let where = { origin: null, path: null };
    try { const u = new URL(href); where = { origin: u.origin, path: u.pathname }; } catch {}
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    const t = Date.now();
    try {
      const r = await orig.call(this, input, init);
      try { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: r.status }) + '\\n'); } catch {}
      return r;
    } catch (e) {
      try { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: null }) + '\\n'); } catch {}
      throw e;
    }
  };
}
`,
  );
  return { path, log };
}

/** Writes `curl` and `node` wrappers into `<dir>/bin` for a live run; returns the bin folder and the curl log. */
export function writeShellProbes(dir, fetchProbe, nodePath = process.execPath) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const curlLog = join(dir, 'curl.log');
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/sh
# Logs each curl call for a benchmark run (T-412), then runs the system curl with a header dump. Output is unchanged.
hdr=${q1(dir)}/curl-hdr-$$-$(date +%s).txt
printf '%s\\t%s\\t' "$(date +%s)" "$hdr" >> ${q1(curlLog)}
printf '%s ' "$@" | tr '\\n' ' ' >> ${q1(curlLog)}
printf '\\n' >> ${q1(curlLog)}
/usr/bin/curl -D "$hdr" "$@"
`,
  );
  chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec ${q1(nodePath)} --import=${q1(fetchProbe)} "$@"\n`);
  chmodSync(join(bin, 'node'), 0o755);
  return { bin, curlLog };
}

/** The calls the probes logged, as { via, method, origin, path, status }. Torn lines are skipped. */
export function readCalls({ fetchLog = null, curlLog = null } = {}) {
  const calls = [];
  if (fetchLog && existsSync(fetchLog)) {
    for (const line of readFileSync(fetchLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        calls.push({ via: 'fetch', method: String(e.method ?? 'GET'), origin: e.origin ?? null, path: e.path ?? null, status: Number.isSafeInteger(e.status) ? e.status : null });
      } catch {
        // a torn line
      }
    }
  }
  if (curlLog && existsSync(curlLog)) {
    for (const line of readFileSync(curlLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [, hdr, argv = ''] = line.split('\t');
      const urls = argv.match(/https?:\/\/[^\s'"]+/g) ?? [];
      const method = (/(?:-X|--request)\s+([A-Z]+)/.exec(argv)?.[1] ?? (/(^|\s)(-d|--data\S*|--json|-F)\s/.test(argv) ? 'POST' : 'GET')).toUpperCase();
      let statuses = [];
      try {
        statuses = (readFileSync(hdr, 'utf8').match(/^HTTP\/[\d.]+\s+(\d{3})/gm) ?? []).map((s) => Number(s.split(/\s+/)[1]));
      } catch {
        statuses = [];
      }
      for (const [i, href] of urls.entries()) {
        let where = { origin: null, path: null };
        try {
          const u = new URL(href);
          where = { origin: u.origin, path: u.pathname };
        } catch {
          // not a URL
        }
        calls.push({ via: 'curl', method, ...where, status: statuses[i] ?? statuses[statuses.length - 1] ?? null });
      }
    }
  }
  return calls;
}
