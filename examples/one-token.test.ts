// One token (plan section 2c, T-379): no tool offers or signs a deal in a token the operators refuse. Against two
// operators that serve only a discovery document for a test deployment whose token is an address, not SimChain's
// `tUSD`, a terms file or template that names `tUSD` stops each tool at start, naming both tokens, before any offer
// is posted or any quote asked. One that names no token takes the operators'.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rehearse, UsageError } from './audit-deal.ts';
import { makeKeys } from './buyer-signer.ts';
import type { DeploymentFile } from './deployments.ts';
import { config as shipped, startSellerAdapter } from './seller-adapter.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const at = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
/** A made-up test deployment: its token is an address, as on every chain. Chain ID 31338, a local test chain. */
const TOKEN = at(0x70);
/** Only the fields a pin reads (verify.ts pinOf); a phase-one record has no second collector or bond vault. */
const DEPLOYMENT = {
  chainId: 31_338, fromBlock: 0, token: { address: TOKEN, name: 'Test USDC', version: '1', symbol: 'tUSDC', decimals: 6 },
  escrow: at(0xe5), erc3009Collector: at(0xc0), multicall: '0xca11bde05977b3631167028862be2a173976ca11', rules: at(0x91), beacon: at(0xbe), expiryMarginSec: 86_400,
} as unknown as DeploymentFile;
const DISCOVERY = {
  domain: { name: 'Holdback', version: '0.8', chainId: 31_338, verifyingContract: at(0x91) },
  settlementTime: new Date().toISOString(), settlementModes: ['guaranteed_on_decision'],
  demo: { clubId: 'demo-club', token: { id: TOKEN, decimals: 6 }, adjudicators: [{ role: 'primary', address: at(0xd1) }, { role: 'fallback', address: at(0xd2) }, { role: 'appeal', address: at(0xd3) }] },
};

let served: TwoOrigins;
const requests: string[] = [];
const dirs: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 't379-token-'));
  dirs.push(d);
  return d;
};
beforeAll(async () => {
  process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(DEPLOYMENT);
  const fake = {
    fetch: async (req: Request) => {
      requests.push(`${req.method} ${new URL(req.url).pathname}`);
      return new Response(JSON.stringify(DISCOVERY), { headers: { 'content-type': 'application/json' } });
    },
    work: async () => {},
  };
  served = await serveTwoOrigins(fake as unknown as Parameters<typeof serveTwoOrigins>[0]);
});
afterAll(async () => {
  delete process.env['HOLDBACK_DEPLOYMENT'];
  await served.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const posted = () => requests.filter((r) => r.startsWith('POST '));

describe('one token: a terms file in another token stops each tool at start, naming both (plan section 2c)', () => {
  it('the rehearsal tool refuses a terms file that names tUSD before any deal opens', async () => {
    const before = posted().length;
    const run = rehearse({ case: 'released', operators: served.urls, dir: dir(), termsFile: here('../fixtures/terms/audit-report.yaml'), log: () => {} });
    await expect(run).rejects.toThrow(UsageError);
    await expect(run).rejects.toThrow(new RegExp(`price\\.token is tUSD; this settlement layer holds ${TOKEN} \\(tUSDC\\)`));
    expect(posted().length).toBe(before);
  });

  it('the seller adapter refuses a template whose fee names tUSD, and takes the operators\' token for a fee that names none', async () => {
    const template = JSON.parse(readFileSync(shipped.template, 'utf8'));
    const d = dir();
    const start = (fee: J) => {
      const file = join(d, `template-${Math.random().toString(16).slice(2)}.json`);
      writeFileSync(file, JSON.stringify({ ...template, fee }));
      return startSellerAdapter({ ...shipped, port: 0, template: file, sellerApi: { quote: 'http://127.0.0.1:1/q', start: 'http://127.0.0.1:1/s', result: 'http://127.0.0.1:1/{jobId}' }, journal: join(d, 'journal.json'), log: () => {} }, { HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: served.urls.join(',') });
    };
    const before = posted().length;
    await expect(start({ token: 'tUSD', amount: '1000000' })).rejects.toThrow(new RegExp(`fee names the token tUSD, and these operators settle in ${TOKEN} \\(tUSDC\\) only`));
    expect(posted().length).toBe(before);
    // A fee that names no token gets past the template; this fake world then stops the start at the mandate, which it cannot grant.
    await expect(start({ amount: '1000000' })).rejects.toThrow(/mandate|faucet|holds no/);
  });

  it('the buyer signer refuses terms whose price or fee names tUSD, and fills the token into terms that name none', async () => {
    const signer = await makeKeys(dir(), { operators: served.urls, log: () => {} });
    expect(await signer.token()).toEqual({ id: TOKEN, symbol: 'tUSDC', decimals: 6 });
    await expect(signer.inToken({ fee: { token: 'tUSD', amount: '1000000' } })).rejects.toThrow(Refusal);
    await expect(signer.inToken({ price: { token: 'tUSD', amount: '5' } })).rejects.toThrow(new RegExp(`your terms' price names the token "tUSD", and these operators settle in ${TOKEN} \\(tUSDC\\) only`));
    expect(await signer.inToken({ fee: { amount: '1000000' }, price: { amount: '5' }, checks: [] })).toEqual({ fee: { token: TOKEN, amount: '1000000' }, price: { token: TOKEN, amount: '5' }, checks: [] });
  });

  it('the buyer\'s command stops before it asks for a quote when --expect-terms names another token', async () => {
    let quotes = 0;
    const seller: Server = createServer((_req, res) => {
      quotes++;
      res.writeHead(500).end('{}');
    });
    await new Promise<void>((r) => seller.listen(0, '127.0.0.1', r));
    try {
      const terms = join(dir(), 'terms.json');
      const timing = { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 86_400, judgeWithinSec: 300, fallbackWithinSec: 300, appealWindowSec: 0, appealDecideSec: 300 };
      writeFileSync(terms, JSON.stringify({ deliverable: { kind: 'dataset', description: 'rows', format: 'text/csv' }, checks: [], timing, fee: { token: 'tUSD', amount: '1000000' }, adjudicators: { primary: at(0xd1), fallback: at(0xd2), appeal: at(0xd3) }, maxSubmissions: 1 }));
      const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
        const child = spawn(process.execPath, [here('./buy-with-signer.ts'), `http://127.0.0.1:${(seller.address() as AddressInfo).port}/quote`, dir(), '"rows"', '99000000', '--expect-terms', terms], { env: { ...process.env, HOLDBACK_OPERATORS: served.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(DEPLOYMENT) } });
        let err = '';
        child.stderr.on('data', (x: Buffer) => (err += x.toString()));
        child.on('exit', (code) => resolve({ code, err }));
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain(`your terms' fee names the token "tUSD", and these operators settle in ${TOKEN} (tUSDC) only`);
      expect(quotes).toBe(0);
    } finally {
      await new Promise<void>((r) => seller.close(() => r()));
    }
  });
});
