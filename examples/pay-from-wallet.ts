// A buyer whose payment address is a wallet outside its tools (ADR-0033): the wallet signs the funding and the operator
// fee, the buyer signer signs the agreement, and nothing here ever holds the wallet's key. Test tokens only.
//   node examples/pay-from-wallet.ts files <key store directory> <commitment ID>
//       writes the two messages the payment address signs, as eth_signTypedData_v4 files beside the key file, and prints
//       one sentence for each: who pays whom how much, until when, for which deal. buy-with-signer.ts runs this step
//       when CROW_PAYMENT_ADDRESS is set. Sign each file in the wallet (see site/llms.txt, "Pay from your own wallet").
//   node examples/pay-from-wallet.ts fund <key store directory> <commitment ID> <funding signature> [<operator-fee signature>]
//       funds the deal with the wallet's signatures, as 0x and 130 hex characters, only if each recovers to the payment
//       address over the message the signer rebuilt from the approved terms. Then follow it with buy-with-signer.ts resume.
//   node examples/pay-from-wallet.ts check <typed-data file> <terms file> <buyer's signing address> [--fee <to> <base units>] [--sim]
//       the check the wallet's holder runs alone before signing: it rebuilds the message from the terms (as
//       GET /v1/commitments/<id>/terms serves them) and its own pinned deployment (Sepolia's in examples/deployments.ts,
//       HOLDBACK_DEPLOYMENT, or SimChain with --sim), never from the file, and prints the sentence or the refusal.
//       --fee: the operator fee's recipient and amount as you read them from the operators, for the operator-fee file.
// Env: HOLDBACK_OPERATORS (files, fund); CROW_EXPECT as for buy-with-signer.ts. Exit status 0 when done, 3 on a refusal.
import { readFileSync } from 'node:fs';
import { loadKeys, printable } from './buyer-signer.ts';
import { command as commandFor } from './entry.ts';
import { checkPaymentFile, commitmentIdOf, knownPins, pinOf, Refusal } from './verify.ts';
import { SEPOLIA } from './deployments.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const args = process.argv.slice(2);
const flag = (name: string, n: number) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, n + 1).slice(1);
};
const fee = flag('--fee', 2), sim = flag('--sim', 0) !== undefined;
const [command, a, b, c, d] = args;
const out = (x: unknown) => console.log(printable(JSON.stringify(x)));
const expect = () => ({ expect: JSON.parse(process.env['CROW_EXPECT'] || '{}') });
const usage = 'usage: pay-from-wallet.ts files <store> <id> | fund <store> <id> <funding signature> [<operator-fee signature>] | check <file> <terms file> <buyer address> [--fee <to> <base units>] [--sim]';

try {
  if (command === 'files' && a && b) {
    const signer = await loadKeys(a, b, { ...expect(), log: () => {} });
    for (const f of await signer.fundingFiles(b)) out({ sign: f.path, digest: f.digest, check: f.check, summary: f.summary });
    console.error('Where the wallet is, run each check above and sign only a file it passes, whose digest the wallet shows.');
  } else if (command === 'fund' && a && b && c) {
    const signer = await loadKeys(a, b, expect());
    const paid = await signer.agreeAndFund(b, { funding: c, operatorFee: d });
    out({ funded: signer.commitmentId, paid: paid.total, from: signer.paymentAddress });
    console.error(`Funded. Follow the deal with: ${commandFor('buy-with-signer', import.meta.url)} resume ${a}`);
  } else if (command === 'check' && a && b && c) {
    if (fee && !(/^0x[0-9a-fA-F]{40}$/.test(fee[0] ?? '') && /^(0|[1-9][0-9]*)$/.test(fee[1] ?? ''))) throw new Refusal('refusing to sign: --fee takes the fee\'s recipient (an address) and its amount (base units as a decimal string)');
    // The holder's own pinned settlement layer, never one an operator or the file names.
    const env = process.env['HOLDBACK_DEPLOYMENT'];
    const pin = sim ? knownPins()[0]! : env ? pinOf(JSON.parse(env)) : SEPOLIA ? pinOf(SEPOLIA) : (() => { throw new Error('no deployment pinned: set HOLDBACK_DEPLOYMENT, or pass --sim'); })();
    const file = JSON.parse(readFileSync(a, 'utf8')) as J;
    const { id, signatures: _s, ...terms } = JSON.parse(readFileSync(b, 'utf8')) as J; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (id !== undefined && String(id).toLowerCase() !== commitmentIdOf(terms)) throw new Refusal('refusing to sign: the terms file names a commitment ID its terms do not hash to');
    const kind = /TransferWithAuthorization|TransferAuthorization/.test(String(file.primaryType)) ? 'operator-fee' : 'funding';
    const r = checkPaymentFile(file, terms, { kind, domain: pin.domain, chain: pin.chain, buyer: c, token: pin.token, ...(fee ? { operatorFee: { to: fee[0]!, amount: fee[1]! } } : {}) });
    out({ ok: true, kind, digest: r.digest, summary: r.summary });
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(printable((e as Error).message));
  process.exitCode = e instanceof Refusal ? 3 : 1;
}
