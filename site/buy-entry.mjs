// The entry of site/buy.mjs (T-393): the buyer's three commands in one pinned file, run with Node and no clone.
//
//   node buy.mjs <args>          examples/buy-with-signer.ts: quote, stop for approval, approve, resume
//   node buy.mjs pay <args>      examples/pay-from-wallet.ts: files, check, fund
//   node buy.mjs record <args>   examples/deal-record.ts: the deal record
//
// The banner site/build.mjs puts before every module declares how a person runs each command
// (globalThis.crowCommands, examples/entry.ts). This file then names the one command it runs (globalThis.crowEntry)
// and imports it. The imports are dynamic and the bundle inlines them, so only the chosen command's top-level code
// runs, after crowEntry is set: buy-with-signer.ts and pay-from-wallet.ts run on import.
const SUBCOMMANDS = { pay: 'pay-from-wallet', record: 'deal-record' };
const word = process.argv[2];
const entry = Object.hasOwn(SUBCOMMANDS, word) ? SUBCOMMANDS[word] : 'buy-with-signer';
if (entry !== 'buy-with-signer') process.argv.splice(2, 1);
Object.defineProperty(globalThis, 'crowEntry', { value: entry, enumerable: false, configurable: false, writable: false });
if (entry === 'pay-from-wallet') await import('../examples/pay-from-wallet.ts');
else if (entry === 'deal-record') await import('../examples/deal-record.ts');
else await import('../examples/buy-with-signer.ts');
