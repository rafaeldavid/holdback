// T-357 review, L5: SimChain reads a settlement's carried delivery only in Held (late work, ADR-0031 SC-5b). Once a
// delivery is posted the settlement names that one, and a carried delivery is ignored: the key released is the
// posted delivery's buyer envelope, never the carried one's.
import { deliveryHash, type Delivery } from '@holdback/core';
import { Deal, SimChain, sign, simActor, simCast, simClub, simGenesis } from '@holdback/settlement/sim';
import { describe, expect, it } from 'vitest';

const START = '2026-11-01T09:00:00Z';

async function deliveredDeal(): Promise<{ chain: SimChain; deal: Deal; posted: Delivery; buyer: `0x${string}`; seller: ReturnType<typeof simCast>['seller'] }> {
  const cast = simCast();
  const club = simClub(simActor('club-operator').address);
  const BOND = 25_000_000_000n;
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  const chain = new SimChain(genesis);
  const deal = new Deal(chain, cast, { club });
  for (const s of [deal.offer(), deal.accept(), deal.agreeAndFund(), deal.deliver()]) {
    const r = await chain.submit(await s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
  }
  chain.advance(5);
  return { chain, deal, posted: deal.delivery!, buyer: cast.buyer.address, seller: cast.seller };
}

/** A second delivery the seller signs for the same deal and never posts: `posted` with `over` applied. */
async function unposted(posted: Delivery, seller: ReturnType<typeof simCast>['seller'], over: Partial<Omit<Delivery, 'signature'>>): Promise<Delivery> {
  const body: Partial<Delivery> = { ...posted, ...over };
  delete body.signature;
  const { signature } = await sign(seller, { ...(body as Omit<Delivery, 'signature'>), type: 'Delivery' as const });
  return { ...(body as Omit<Delivery, 'signature'>), signature };
}

describe('a settlement in Delivered ignores a carried delivery (T-357 review, L5)', () => {
  it('releases the posted delivery’s buyer key, not the carried delivery’s', async () => {
    const { chain, deal, posted, buyer, seller } = await deliveredDeal();
    // A second delivery the seller signed but never posted, with its own content and its own buyer envelope.
    const carried = await unposted(posted, seller, {
      plaintextSha256: `sha256:${'e'.repeat(64)}`,
      encryptedKeys: posted.encryptedKeys.map((k) => ({ ...k, ciphertext: `${k.ciphertext}-other` })),
    });

    const r = await chain.submit(await deal.mutual({ releaseKey: true, carry: carried }));
    expect(r.ok ? r.events.map((e) => e.type) : [r.problem.type, r.problem.detail]).toEqual(['commitment.settled', 'key.released']);
    expect(chain.escrowState(deal.id)?.kind).toBe('Settled');
    const keys = await chain.keysFor(deal.id, buyer);
    const postedEnvelope = posted.encryptedKeys.find((k) => k.recipient.toLowerCase() === buyer.toLowerCase())!;
    expect(keys.map((k) => k.ciphertext)).toEqual([postedEnvelope.ciphertext]);
  });

  it('still refuses a settlement in Delivered that names the carried delivery instead of the posted one', async () => {
    const { chain, deal, posted, seller } = await deliveredDeal();
    const carried = await unposted(posted, seller, { plaintextSha256: `sha256:${'e'.repeat(64)}` });
    const r = await chain.submit(await deal.mutual({ releaseKey: true, carry: carried, deliveryHash: deliveryHash(carried) }));
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_terms', 'deliveryHash does not name the current delivery']);
    expect(chain.escrowState(deal.id)?.kind).toBe('Delivered');
  });
});
