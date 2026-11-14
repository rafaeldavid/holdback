// Crow's buying agent (T-435): one purchase paid from Crow's float, where the agent holds no key that can pay. It runs
// the buyer's tools as they are (buyer-signer.ts, verify.ts), sends the one message the float must sign to Crow's
// signer (examples/signer.ts) and takes no money from the faucet for the float. A new file, so the buyer's pinned
// bundle (site/buy.mjs) is unchanged: nothing here runs unless this command is run. Test tokens only.
//   node examples/own-buyer.ts <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> --signer <URL> [--expect-terms <file>] [--stop-after-funding]
//       reads the float's address from the signer, quotes with it as the payment address, reads and checks the offer
//       from every operator, asks the test service's faucet for the deal key's mandate (and 1 base unit of the test
//       token to the deal key, the least a grant gives; nothing to the float), writes the funding message, asks the
//       signer to sign it, funds, and follows the deal to its outcome. --expect-terms: as buy-with-signer.ts takes it,
//       a first check of the agent's own, which stops the run on any difference. The signer's rules decide; this
//       command's own checks are the agent's and an agent that is taken over skips them.
// Env: HOLDBACK_OPERATORS, CROW_EXPECT as for buy-with-signer.ts. Exit status 0 when done, 2 on a wrong call, 3 when
// the signer or a check refused (nothing is paid), 1 on an error.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './entry.ts';
import { makeKeys, printable } from './buyer-signer.ts';
import { jcs, Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADDRESS = /^0x[0-9a-f]{40}$/;
const say = (x: unknown) => console.error(printable(JSON.stringify(x)));

/** The signer's answer to one request; a refusal names its rule. */
async function ask(signer: string, path: string, body?: J): Promise<{ status: number; body: J }> {
  const res = await fetch(`${signer.replace(/\/$/, '')}${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export type Bought = { commitmentId: string; paid: string; from: string; outcome?: string; work?: J };

/** One purchase through Crow's signer. Throws Refusal when the signer or a check refuses; nothing is paid then. */
export async function buyThroughSigner(o: { quoteUrl: string; store: string; scope: J; most: string; signer: string; operators?: string[]; expectTerms?: J; stopAfterFunding?: boolean; log?: (l: string) => void }): Promise<Bought> {
  const status = await ask(o.signer, '/v1/status');
  const float = String(status.body?.floatAddress ?? '');
  if (status.status !== 200 || !ADDRESS.test(float)) throw new Error(`the signer at ${o.signer} answered no float address (status ${status.status})`);
  if (status.body.state !== 'running') throw new Refusal(`refusing: the signer is ${printable(String(status.body.state))}: nothing is asked or paid`);
  const buyer = await makeKeys(o.store, { paymentAddress: float, ...(o.operators ? { operators: o.operators } : {}), ...(o.log ? { log: o.log } : {}), expect: JSON.parse(process.env['CROW_EXPECT'] || '{}') });
  const own = o.expectTerms ? await buyer.inToken(o.expectTerms) : undefined;
  const quote = await buyer.quote(o.quoteUrl, o.scope);
  const offer = await buyer.readOffer(quote.commitmentId, own ? { defaults: own } : {});
  const differences = [...(offer.differences ?? []), ...(['price', 'seller'] as const).filter((f) => own?.[f] !== undefined && jcs(own[f]).toLowerCase() !== jcs((offer as J)[f]).toLowerCase()).map((f) => ({ field: f }))];
  if (own && differences.length) throw new Refusal(`refusing: the offer differs from the expected terms in ${differences.map((d) => d.field).join(', ')}: nothing is signed or paid`);
  if (BigInt(offer.fees.total.amount) > BigInt(o.most)) throw new Refusal(`refusing: the offer costs ${offer.fees.total.amount} base units, above ${o.most}: nothing is signed or paid`);
  await buyer.checkOffer(quote.commitmentId, offer);
  // The deal key's mandate in the demo club (the test service's faucet signs it). The grant's least amount, 1 base
  // unit, goes to the deal key: the float gets nothing from the faucet.
  const ops = o.operators ?? String(process.env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
  const grant = await fetch(`${ops[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ address: buyer.address, amount: '1' }) });
  if (!grant.ok) throw new Error(`the faucet gave the deal key no mandate (${grant.status}): nothing is signed or paid`);
  const files = await buyer.fundingFiles(quote.commitmentId);
  if (files.some((f) => f.name !== 'funding')) throw new Refusal('refusing: these operators charge an operator fee, and Crow\'s signer signs no transfer but a deal\'s funding (B14): nothing is paid. Use an operator that charges none, or the contracts directly');
  const terms = JSON.parse(readFileSync(join(o.store, `${buyer.address}.terms.json`), 'utf8'));
  const file = JSON.parse(readFileSync(files[0]!.path, 'utf8'));
  const signed = await ask(o.signer, '/v1/sign', { kind: 'payment', terms, file });
  if (signed.status !== 200) throw new Refusal(`refusing: the signer refused (${printable(String(signed.body?.rule))}): ${printable(String(signed.body?.detail ?? signed.status))}. Nothing is paid`);
  writeFileSync(join(o.store, `${buyer.address}.delegation.json`), `${JSON.stringify(signed.body.delegation, null, 2)}\n`, { mode: 0o600 });
  const paid = await buyer.agreeAndFund(quote.commitmentId, { funding: signed.body.funding });
  const out: Bought = { commitmentId: quote.commitmentId, paid: paid.total.amount, from: float };
  if (o.stopAfterFunding) return out;
  const done = await buyer.openDelivery(quote.commitmentId, { onReport: say });
  return { ...out, outcome: done.outcome, work: done.work };
}

const USAGE = 'node examples/own-buyer.ts <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> --signer <URL> [--expect-terms <file>] [--stop-after-funding]';

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const flag = (name: string, n: number) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, n + 1).slice(1);
  };
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE), 0;
  const signer = flag('--signer', 1)?.[0], terms = flag('--expect-terms', 1)?.[0], stop = flag('--stop-after-funding', 0) !== undefined;
  const [quoteUrl, store, scope, most] = args;
  if (args.length !== 4 || !signer || !/^[0-9]+$/.test(most ?? '')) return console.error(USAGE), 2;
  const bought = await buyThroughSigner({ quoteUrl: quoteUrl!, store: store!, scope: JSON.parse(scope!), most: most!, signer, ...(terms ? { expectTerms: JSON.parse(readFileSync(terms, 'utf8')) } : {}), stopAfterFunding: stop });
  console.log(printable(JSON.stringify(bought)));
  if (stop) console.error(`Funded from ${bought.from}. Follow the deal with: node examples/buy-with-signer.ts resume ${store}`);
  return 0;
}

if (isMain(import.meta.url, 'own-buyer')) {
  main(process.argv.slice(2)).then(
    (code) => void (process.exitCode = code),
    (e: unknown) => {
      console.error(printable((e as Error).message));
      process.exitCode = e instanceof Refusal ? 3 : 1;
    },
  );
}
