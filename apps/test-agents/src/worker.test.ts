// The Worker's Durable Object around the seller: it refuses to start without its Sepolia-only secret, signs for the
// pinned Sepolia deployment only, and keeps the alarm set while any deal is open, whatever request arrives.
import { MemoryStorage } from '@holdback/demo-cloud';
import { describe, expect, it } from 'vitest';
import { SEPOLIA } from '../../../examples/deployments.ts';
import { Agents, type Env } from './worker.ts';

class FakeStorage extends MemoryStorage {
  alarm: number | null = null;
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
}

// Unreachable operators: nothing here needs them.
const env = (seed?: string): Env => ({ AGENTS: undefined as never, OPERATOR_URLS: 'http://127.0.0.1:9,http://localhost:9', SELLER_URL: 'https://escrow.stream/agents/test-seller', ...(seed ? { TEST_AGENTS_SEED: seed } : {}) });
const get = (path: string) => new Request(`https://escrow.stream/agents/test-seller${path}`);

describe('the crow-test-agents Durable Object', () => {
  it('refuses to start without TEST_AGENTS_SEED, or with a malformed one', async () => {
    for (const seed of [undefined, '0x1234']) {
      const agents = new Agents({ storage: new FakeStorage() }, env(seed));
      await expect(agents.fetch(get('/health'))).rejects.toThrow(/TEST_AGENTS_SEED is not set/);
    }
  });

  it('signs for the pinned Sepolia deployment only', async () => {
    const agents = new Agents({ storage: new FakeStorage() }, env(`0x${'22'.repeat(32)}`));
    const card = await (await agents.fetch(get('/agent.json'))).json();
    expect(card.offers[0].terms.price.token).toBe(SEPOLIA!.token.address.toLowerCase());
  });

  it('re-arms a missing alarm on any request while a deal is open, and sets none while idle', async () => {
    const storage = new FakeStorage();
    const agents = new Agents({ storage }, env(`0x${'22'.repeat(32)}`));
    expect((await agents.fetch(get('/health'))).status).toBe(200);
    expect(storage.alarm).toBeNull();
    // An open deal whose alarm chain was lost: the next request of any kind brings the alarm back.
    await storage.put({ 'o:000000001': 1, 'd:000000001': { n: 1, status: 'received' } });
    expect((await agents.fetch(get('/health'))).status).toBe(200);
    expect(storage.alarm).not.toBeNull();
  });
});
