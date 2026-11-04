// The public demo's own world (apps/demo-cloud, the code the live nodes run, with their 1 bp operator fee) served in
// this process on two origins, as examples/try.test.ts serves it: http://127.0.0.1:<port> is node 0 and
// http://localhost:<port> node 1. The test agents reach it over HTTP only, like any agent. Tests only.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from '@holdback/demo-cloud';

export interface TestWorld {
  urls: [string, string];
  world: PublicWorld;
  close(): Promise<void>;
}

export async function serveWorld(o: Partial<PublicWorldOptions> = {}): Promise<TestWorld> {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 1000, ...o });
  const server: Server = createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    const node = host.startsWith('localhost') ? 1 : 0;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const r = await world.fetch(new Request(`http://${host}${req.url}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }), { node, origin: `http://${host}`, client: req.socket.remoteAddress ?? 'unknown' });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  let ticking = true;
  const loop = (async () => {
    while (ticking) {
      await world.work();
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  return {
    urls: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    world,
    close: async () => {
      ticking = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}
