// The public demo's own world (apps/demo-cloud, the code the live nodes run; this test world keeps a 1 bp operator fee, which the live nodes charged before T-389 set theirs to 0) served in
// this process on two origins, as examples/try.test.ts serves it: http://127.0.0.1:<port> is node 0 and
// http://localhost:<port> node 1. The test agents reach it over HTTP only, like any agent. Tests only.
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from '@holdback/demo-cloud';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';

export interface TestWorld {
  urls: [string, string];
  world: PublicWorld;
  close(): Promise<void>;
}

export async function serveWorld(o: Partial<PublicWorldOptions> = {}): Promise<TestWorld> {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 1000, ...o });
  const { urls, close } = await serveTwoOrigins(world, { tickMs: 50 });
  return { urls, world, close };
}
