// What each client command does, how it is called and one complete example call (T-397), in one place, so a command
// answers --help and -h the same way it answers a wrong call. Each command is named as it is run (entry.ts): unbundled
// as `node examples/<name>.ts`, in site/buy.mjs as `node buy.mjs …`. The examples use realistic values and no secret.
// The buyer's example is the call site/buy.txt gives (tests/site-guides.test.ts checks that they are the same).
import { command } from './entry.ts';

export { command };

/** A commitment ID as an example: a public hash, not a secret. */
const ID = '0x5744dce2d35d087b9bf35bd4443a99807baa5bb2b94185c0b21505e0167309f7';

type Help = { what: string; usage: (me: string) => string[]; example: (me: string) => string };

const HELP = {
  'buy-with-signer': {
    what: 'buys one job from a seller that prices by quote: it asks for the price, stops for your approval, then funds the deal, follows it and opens the work.',
    usage: (me) => [
      `${me} <quote URL> <key store directory> '<scope as JSON>' <the most you pay, base units> [<defaults URL> [<options as JSON>]] [--expect-terms <file>] [--stop-after-funding]`,
      `${me} approve <key store directory> <commitment ID> <the most you pay, base units> [--stop-after-funding]`,
      `${me} resume <key store directory> [<commitment ID>] [--delivery <file>]`,
    ],
    example: (me) => `HOLDBACK_OPERATORS=$OP1,$OP2 ${me} https://seller.example/quote deal-1 '{"commit":"7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c","files":["contracts/Vault.sol"]}' 750000000 https://seller.example/defaults`,
  },
  'pay-from-wallet': {
    what: 'funds a deal from a wallet outside these tools: it writes the messages the wallet signs, checks a file where the wallet is, and funds with the signatures.',
    usage: (me) => [
      `${me} files <key store directory> <commitment ID>`,
      `${me} check <typed-data file> <terms file> <buyer's signing address> [--fee <to> <base units>] [--sim]`,
      `${me} fund <key store directory> <commitment ID> <funding signature> [<operator-fee signature>]`,
    ],
    example: (me) => `HOLDBACK_OPERATORS=$OP1,$OP2 ${me} files deal-1 ${ID}`,
  },
  'deal-record': {
    what: "writes one JSON record of a deal, read from every operator: the signed terms, each step, the checks and the judgment, and the settlement. It changes nothing on the operators.",
    usage: (me) => [`${me} <commitmentId> --as buyer|seller [--delivery <file>] [--settlement <file>] [--out <file>]`],
    example: (me) => `HOLDBACK_OPERATORS=$OP1,$OP2 ${me} ${ID} --as buyer --out record.json`,
  },
  'seller-adapter': {
    what: "sells your API's jobs on Crow: it serves /quote and /defaults, signs each offer, waits for the hold, runs the job and delivers the checked result.",
    usage: (me) => [`${me} <config.json> [--sim]`, '  The file names your API (sellerApi) and any setting you change; HOLDBACK_KEY and HOLDBACK_OPERATORS come from the environment, or --sim takes both from a running `pnpm sim`. A sample file: examples/seller-adapter.config.json.'],
    example: (me) => `${me} seller.json --sim`,
  },
} satisfies Record<string, Help>;

const isHelp = (a: string | undefined) => a === '--help' || a === '-h';
/**
 * The exit status a request for help takes, or null for none (T-397). `--help` or `-h` as the first argument asks for
 * help: 0. Anywhere else it is a wrong call, so it exits 2 with the help printed and nothing run: exit 0 means "passed"
 * to some of these commands, and a path that happens to be `-h` must not read as a pass.
 */
export const helpAsked = (args: readonly string[]): 0 | 2 | null => (isHelp(args[0]) ? 0 : args.some(isHelp) ? 2 : null);

/**
 * The help of the command `name` (a file in examples/, without `.ts`), named as it is run from `from` (the caller's
 * import.meta.url): a line saying what it does, the usage, and one example call.
 */
export function help(name: keyof typeof HELP, from: string): string {
  const h: Help = HELP[name];
  const me = command(name, from);
  const [first, ...more] = h.usage(me);
  return [`${name}: ${h.what}`, `usage: ${first}`, ...more.map((l) => (l.startsWith('  ') ? l : `       ${l}`)), `example: ${h.example(me)}`].join('\n');
}

