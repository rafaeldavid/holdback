// Signs a prepared message (POST /v1/prepare/<kind> output) with HOLDBACK_KEY and prints the body to submit.
// Usage: HOLDBACK_KEY=0x… node examples/sign.ts prepared.json > body.json   (docs/quickstart.md)
import { readFileSync } from 'node:fs';
import { hashTypedData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type Field = { name: string; type: string };
// The operator sends integers as decimal strings; EIP-712 libraries hash integers.
const ints = (types: Record<string, Field[]>, type: string, v: any): any => // eslint-disable-line @typescript-eslint/no-explicit-any
  type.endsWith('[]') ? v.map((x: unknown) => ints(types, type.slice(0, -2), x))
  : types[type] ? Object.fromEntries(types[type].map((f) => [f.name, ints(types, f.type, v[f.name])]))
  : /^u?int\d*$/.test(type) ? BigInt(v) : v;

const prepared = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const account = privateKeyToAccount(process.env['HOLDBACK_KEY'] as Hex);
for (const s of prepared.sign.filter((x: { signer: string }) => x.signer.toLowerCase() === account.address.toLowerCase())) {
  const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) };
  if (hashTypedData(typed) !== s.digest) throw new Error(`${s.slot}: typed data does not hash to the digest; do not sign`);
  const path: string[] = s.slot.split('.');
  const parent = path.slice(0, -1).reduce((o, k) => o[k], prepared.submit.body);
  parent[path.at(-1)!] = await account.signTypedData(typed);
}
console.log(JSON.stringify(prepared.submit.body));
