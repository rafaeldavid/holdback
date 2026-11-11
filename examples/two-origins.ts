// One world served as two operator nodes over HTTP, for tests: http://127.0.0.1:<port> is node 0 and
// http://localhost:<port> is node 1, on one port. A timer stands in for the Durable Object's alarm. The examples'
// tests, the demo world's tests and the test agents' tests all serve the world through this file, the last two by
// relative path, as they import agent.ts. Tests import it, and so does audit-deal.ts for its local run.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PublicWorld } from '@holdback/demo-cloud';

export interface TwoOriginsOptions {
  /** Milliseconds between the world's passes. Without it no pass runs: the test calls `world.work()` itself. */
  tickMs?: number | undefined;
  /** The client every request counts under; by default the socket's remote address. */
  client?: string | undefined;
  /** Sends the world's own `content-length` header; by default Node sets the header from the body it sends. */
  keepContentLength?: boolean;
  /** Replaces the body of a successful answer; `undefined` sends the world's body unchanged. */
  rewrite?: ((node: number, path: string, body: string) => string | undefined) | undefined;
}

export interface TwoOrigins {
  urls: [string, string];
  /** Every request that carried a body, as "METHOD /path", in the order received. */
  requests: string[];
  close(): Promise<void>;
}

export async function serveTwoOrigins(world: Pick<PublicWorld, 'fetch' | 'work'>, o: TwoOriginsOptions = {}): Promise<TwoOrigins> {
  const requests: string[] = [];
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    if (body) requests.push(`${req.method} ${req.url}`);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: o.client ?? req.socket.remoteAddress ?? 'unknown' });
    const out = Buffer.from(await r.arrayBuffer());
    const text = o.rewrite && r.ok ? o.rewrite(node, req.url ?? '', out.toString()) : undefined;
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => o.keepContentLength || k !== 'content-length')));
    res.end(text ?? out);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = o.tickMs !== undefined;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, o.tickMs));
    }
  })();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    requests,
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}
