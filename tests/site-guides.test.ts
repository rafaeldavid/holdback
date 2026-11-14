// The agent guides' helpers (T-393, site/guides.mjs): the budget's count, with and without a provider key, and the
// checks site/check.mjs runs on the guides. No network: the provider is a fake fetch.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JavaScript module with no declarations
import { apiRoutes, citedSections, countTokens, duplicateSentences, estimateTokens, FIRST_DEAL_BUDGET, guideFiles, hasSection, HTTP_BUYER_BUDGET, measureHttpBuyer, measurePaths, namedCalls, namedReferences, nonAscii, routeKnown } from '../site/guides.mjs';
// @ts-expect-error plain JavaScript module with no declarations
import { publishedGuides } from '../site/build.mjs';

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe("the plain-HTTP buyer's budget (T-426)", () => {
  it('is the front door plus the three reference pages a first purchase over HTTP reads', () => {
    expect(HTTP_BUYER_BUDGET).toEqual({ tokens: 9450, target: 8700, path: ['llms.txt', 'ref/http.txt', 'ref/signing.txt', 'ref/http-buyer.txt'] });
    for (const p of HTTP_BUYER_BUDGET.path) expect(guideFiles()).toContain(p);
  });

  it('estimates the pages joined by a newline, bytes divided by four', () => {
    const published = new Map([['llms.txt', 'a'.repeat(4)], ['ref/http.txt', 'b'.repeat(4)], ['ref/signing.txt', 'c'.repeat(4)], ['ref/http-buyer.txt', 'd'.repeat(5)]]);
    expect(measureHttpBuyer(published)).toEqual({ files: HTTP_BUYER_BUDGET.path, bytes: 20, tokens: 5 });
  });

  it('holds the published path within the budget, so an edit that grows it fails', () => {
    const m = measureHttpBuyer(publishedGuides({ op1: 'https://op1.example.workers.dev', op2: 'https://op2.example.workers.dev' }));
    expect(m.tokens, `the plain-HTTP buyer's path is ${m.bytes} bytes, ${m.tokens} tokens, over ${HTTP_BUYER_BUDGET.tokens}`).toBeLessThanOrEqual(HTTP_BUYER_BUDGET.tokens);
  });
});

describe('the first-deal budget', () => {
  it('is stated once, for the buyer and the seller, each the front door plus its page', () => {
    expect(FIRST_DEAL_BUDGET.tokens).toBe(5000);
    expect(FIRST_DEAL_BUDGET.paths).toEqual({ buyer: ['llms.txt', 'buy.txt'], seller: ['llms.txt', 'sell.txt'] });
    expect(guideFiles().slice(0, 3)).toEqual(['llms.txt', 'buy.txt', 'sell.txt']);
  });

  it('estimates bytes divided by four, rounded up, without a key, and says so', async () => {
    expect(estimateTokens('abcde')).toBe(2);
    const published = new Map([['llms.txt', 'a'.repeat(400)], ['buy.txt', 'b'.repeat(399)], ['sell.txt', 'c'.repeat(3)]]);
    const [buyer, seller] = await measurePaths(published, { key: undefined });
    expect(buyer).toMatchObject({ role: 'buyer', bytes: 800, tokens: 200, estimate: 200, counted: null, method: 'estimate, bytes divided by four: no key set' });
    expect(seller).toMatchObject({ role: 'seller', bytes: 404, tokens: 101 });
  });

  it("counts with the provider's count_tokens for the pinned model when a key is set", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const f = async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response(JSON.stringify({ input_tokens: 1234 }), { status: 200 }));
    const [buyer] = await measurePaths(new Map([['llms.txt', 'front'], ['buy.txt', 'page'], ['sell.txt', 'x']]), { key: 'k', fetch: f });
    expect(buyer).toMatchObject({ tokens: 1234, counted: 1234, estimate: 3, method: 'count_tokens for claude-opus-5-5' });
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(sent[0]!.init.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'front\npage' }] });
  });

  it('refuses an answer that is not a count, naming the status', async () => {
    await expect(countTokens('x', { key: 'k', fetch: answer(401, { error: { message: 'invalid x-api-key' } }) })).rejects.toThrow('count_tokens answered 401: invalid x-api-key');
    await expect(countTokens('x', { key: 'k', fetch: answer(200, { input_tokens: 'many' }) })).rejects.toThrow('count_tokens answered 200');
  });
});

describe('the checks on the guides', () => {
  it('finds a sentence that is in two guides, and ignores short ones and code blocks', () => {
    const guides = new Map([
      ['a.txt', 'Intro. The operators pay the gas for every deal on Sepolia.\n\n```sh\nThe same line inside a code block is not prose at all.\n```\nShort one.'],
      ['b.txt', '- **The operators pay the gas for every deal on Sepolia.** Short one.\nThe same line inside a code block is not prose at all.'],
    ]);
    expect(duplicateSentences(guides)).toEqual([{ sentence: 'the operators pay the gas for every deal on sepolia.', files: ['a.txt', 'b.txt'] }]);
  });

  it('reads the routes docs/api.md describes and matches the calls a guide names against them', () => {
    const routes = apiRoutes('Use `POST /v1/faucet` and `GET /v1/commitments/{id}/terms`.\n| POST | `/v1/prepare/{kind}` | x |');
    expect([...routes].sort()).toEqual(['GET /v1/commitments/{x}/terms', 'POST /v1/faucet', 'POST /v1/prepare/{x}']);
    const calls = namedCalls('Run `curl -s $OP1/v1/commitments/<id>/terms` then `POST /v1/prepare/offer`, and\ncurl -s -X POST $OP1/v1/faucet -H \'content-type: application/json\'\ncurl -s $OP2/v1/commitments/<id>/nothing');
    expect(calls.sort()).toEqual(['GET /v1/commitments/<id>/nothing', 'GET /v1/commitments/<id>/terms', 'POST /v1/faucet', 'POST /v1/prepare/offer']);
    expect(calls.map((c: string) => routeKnown(c, routes))).toEqual([false, true, true, true]);
    expect(routeKnown('GET /v1/faucet', routes)).toBe(false);
  });

  it('finds every character above 127 in a guide, by line and code point', () => {
    expect(nonAscii('Crow. Plain text...\nprice x bps - 1')).toEqual([]);
    expect(nonAscii('ok\n\u2019crow \u2026 \u00d7\n\u00e9')).toEqual([{ line: 2, char: 'U+2019' }, { line: 2, char: 'U+2026' }, { line: 2, char: 'U+00D7' }, { line: 3, char: 'U+00E9' }]);
  });

  it('holds every published guide to ASCII', () => {
    for (const p of guideFiles()) expect(nonAscii(readFileSync(new URL(`../site/${p}`, import.meta.url), 'utf8')), p).toEqual([]);
  });

  it('lists the reference files a guide names', () => {
    expect(namedReferences('See `ref/http.txt`, https://crow.direct/ref/signing.txt and ref/http.txt again.')).toEqual(['ref/http.txt', 'ref/signing.txt']);
  });

  it('reads the sections a guide cites and finds them as headings or bold leads', () => {
    const cited = citedSections('See `ref/http.txt`, "Make your keys", and the front door\'s "Try it".');
    expect(cited).toEqual([{ file: 'ref/http.txt', title: 'Make your keys' }, { file: 'llms.txt', title: 'Try it' }]);
    expect(hasSection('# T\n\n## Make your keys\n', 'Make your keys')).toBe(true);
    expect(hasSection('## Try it: one test deal\n', 'Try it')).toBe(true);
    expect(hasSection('- **Run it as a service.** text\n', 'Run it as a service')).toBe(true);
    expect(hasSection('## Make your keys now\n', 'Make your keys')).toBe(false);
  });

  it("fills buy.txt's install command, and only buy.txt's", async () => {
    // @ts-expect-error plain JavaScript module with no declarations
    const { guidePage } = await import('../site/build.mjs');
    expect(guidePage('Run:\n{{BUY_INSTALL}}\n', 'buy.txt', () => 'mkdir -p crow-buy')).toBe('Run:\nmkdir -p crow-buy\n');
    expect(() => guidePage('Run {{BUY_INSTALL}}', 'sell.txt')).toThrow('sell.txt has a {{placeholder}}');
  });

  it("runs each of buy.mjs's subcommands, and only that one, with no network", async () => {
    const { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    // buy.mjs imports viem and tweetnacl as packages: run it from a folder that has them, as crow-buy does.
    const dir = mkdtempSync(join(tmpdir(), 'crow-buy-'));
    mkdirSync(join(dir, 'node_modules'));
    for (const p of ['viem', 'tweetnacl']) symlinkSync(realpathSync(new URL(`../examples/node_modules/${p}`, import.meta.url)), join(dir, 'node_modules', p));
    copyFileSync(new URL('../site/buy.mjs', import.meta.url), join(dir, 'buy.mjs'));
    const run = (...args: string[]) => spawnSync(process.execPath, ['buy.mjs', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
    const pay = run('pay');
    expect(pay.stderr).toMatch(/usage: node buy\.mjs pay files <key store directory> <commitment ID>\n\s+node buy\.mjs pay check /);
    expect(pay.stderr).not.toMatch(/usage: approve|deal-record/);
    const record = run('record');
    expect(record.stderr).toMatch(/usage: node buy\.mjs record <commitmentId> --as buyer\|seller/);
    expect(record.stderr).not.toMatch(/files <store>/);
    const approve = run('approve', 'deal-1', 'not-an-id', '1');
    expect(approve.stderr).toMatch(/usage: node buy\.mjs <quote URL> <key store directory> '<scope as JSON>' <the most you pay, base units>/);
    expect(approve.stderr).toMatch(/node buy\.mjs approve <key store directory> <commitment ID>/);
    expect(approve.stderr).not.toMatch(/--as buyer\|seller|files <key store/);
    // T-397: --help and -h answer with exit 0, and the buyer's example is the call buy.txt gives.
    for (const [args, name] of [[['--help'], 'buy-with-signer'], [['-h'], 'buy-with-signer'], [['pay', '--help'], 'pay-from-wallet'], [['record', '-h'], 'deal-record']] as const) {
      const r = run(...args);
      expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^${name}: [^\\n]+\\nusage: node buy\\.mjs`));
      expect(r.stdout).toMatch(/\nexample: \S/);
    }
    // Help anywhere but first is a wrong call: it prints the help, runs nothing and exits 2, never 0 ("passed").
    const late = run('record', '0x5744dce2d35d087b9bf35bd4443a99807baa5bb2b94185c0b21505e0167309f7', '--as', 'buyer', '--out', '-h');
    expect(late.status).toBe(2);
    expect(late.stderr).toMatch(/^deal-record: /);
    const example = /\nexample: (.+)/.exec(run('--help').stdout)?.[1] ?? '';
    // @ts-expect-error plain JavaScript module with no declarations
    const { publishedGuides } = await import('../site/build.mjs');
    expect(publishedGuides({ op1: 'https://a.example', op2: 'https://b.example' }).get('buy.txt').split('\n').map((l: string) => l.trim())).toContain(example);
  });
});

