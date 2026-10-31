// The judge timeout (policy.judgeTimeoutSec) and routing by the seat's provider. The pipeline retries
// once on a transport error; a timeout is recorded and not retried.
import type { JudgeProvider, JudgeResponse } from '@holdback/judgment';

/** Resolves to `{ kind: 'timeout' }` after `timeoutMs`. Adds measured latency unless the answer carries one. */
export function withTimeout(inner: JudgeProvider, timeoutMs: number): JudgeProvider {
  return {
    async complete(req) {
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<JudgeResponse>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      });
      try {
        const res = await Promise.race([inner.complete(req), timeout]);
        if (res.kind === 'ok' && res.latencyMs === undefined) return { ...res, latencyMs: Math.round(performance.now() - started) };
        return res;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Dispatches on `request.provider`; an unknown provider is a non-transport error (no retry). */
export function routeByProvider(providers: Readonly<Record<string, JudgeProvider>>): JudgeProvider {
  return {
    async complete(req) {
      const p = Object.hasOwn(providers, req.provider) ? providers[req.provider] : undefined;
      if (!p) return { kind: 'error', transport: false, detail: `no provider configured for ${req.provider}` };
      return p.complete(req);
    },
  };
}
