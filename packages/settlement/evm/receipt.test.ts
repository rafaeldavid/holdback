// Receipt waits on anvil (T-035). A send's first receipt check can run before anvil has mined the transaction; on CI
// runners that happened in about one test in six. viem's waitForTransactionReceipt then asked again only when a
// block-number poller, shared by every wait on the client, saw a block above the one it first read: anvil in automine
// mines none while the test waits, and evm_revert moves the head below a poller another wait left running, so the
// wait slept until viem's 180 s timeout. These tests hold anvil's mining back so the first check always misses; on
// viem's wait the first two hang and the third never reports.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { anvilAvailable, ANVIL_DEPLOYER_KEY, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
/** An address with no code: a value transfer to it always succeeds. */
const TO = `0x${'5e'.repeat(20)}` as const;

describe.skipIf(!ready)(`receipt waits on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root, { receiptTimeoutMs: 2_000 });
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });
  afterEach(async () => {
    await world.rpc('anvil_dropAllTransactions', []);
    await world.rpc('evm_setAutomine', [true]);
  });

  /** Resolves once anvil's pool holds `n` pending transactions, so a wait has started on a transaction not yet mined. */
  const pooled = async (n: number) => {
    for (let i = 0; i < 200; i++) {
      if ((await world.rpc<{ pending: Hex }>('txpool_status', [])).pending === `0x${n.toString(16)}`) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`anvil's pool never held ${n} pending transactions`);
  };
  /** Lets a wait that just missed its first check read the head, as viem's wait did. */
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it('a wait finds its receipt when the transaction lands below the head it first saw', async () => {
    const snapshot = await world.rpc<Hex>('evm_snapshot', []);
    await world.rpc('anvil_mine', ['0x5']);
    await world.rpc('evm_setAutomine', [false]);
    const account = privateKeyToAccount(ANVIL_DEPLOYER_KEY);
    const nonce = await world.publicClient.getTransactionCount({ address: account.address });
    const raw = await account.signTransaction({ chainId: world.chainId, type: 'eip1559', to: TO, value: 1n, gas: 21_000n, nonce, maxFeePerGas: 10n ** 10n, maxPriorityFeePerGas: 1n });
    const hash = await world.rpc<Hex>('eth_sendRawTransaction', [raw]);
    const waiting = world.receipt(hash);
    await settle();
    // The same signed transaction, mined five blocks below that head: no block above it ever comes.
    expect(await world.rpc('evm_revert', [snapshot])).toBe(true);
    await world.rpc('anvil_dropAllTransactions', []);
    await world.rpc('evm_setAutomine', [true]);
    expect(await world.rpc('eth_sendRawTransaction', [raw])).toBe(hash);
    expect((await waiting).status).toBe('success');
  });

  it('a wait left running across evm_revert does not hold up the next send', async () => {
    const snapshot = await world.rpc<Hex>('evm_snapshot', []);
    await world.rpc('anvil_mine', ['0x5']);
    await world.rpc('evm_setAutomine', [false]);
    // What a timed-out test leaves behind: a wait whose transaction will never mine.
    const left = world.send({ to: TO, data: '0x', value: 2n }).then(() => null, (e: Error) => e);
    await pooled(1);
    await settle();
    expect(await world.rpc('evm_revert', [snapshot])).toBe(true);
    await world.rpc('anvil_dropAllTransactions', []);
    // The next deal's send, five blocks below the head the first wait saw, mined after its first check missed.
    const sending = world.send({ to: TO, data: '0x', value: 3n });
    await pooled(1);
    await world.rpc('evm_mine', []);
    expect((await sending).status).toBe('success');
    expect((await left)?.message).toMatch(/^anvil returned no receipt for 0x[0-9a-f]{64} within 2 s: the transaction is unknown to anvil/);
  });

  it('a transaction anvil never mines fails at the receipt deadline, naming the hash and the pool', async () => {
    await world.rpc('evm_setAutomine', [false]);
    const failed = await world.send({ to: TO, data: '0x', value: 4n }).then(() => null, (e: Error) => e);
    expect(failed?.message).toMatch(/^anvil returned no receipt for 0x[0-9a-f]{64} within 2 s: the transaction is pending; automine off; txpool \{"pending":"0x1","queued":"0x0"\}$/);
  });
});

describe('the anvil world', () => {
  it("waits for receipts with its own poll, never viem's waitForTransactionReceipt", () => {
    const dir = import.meta.dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources).toContain('world.ts');
    expect(sources.filter((f) => /\.waitForTransactionReceipt\(/.test(readFileSync(join(dir, f), 'utf8')))).toEqual([]);
  });
});
