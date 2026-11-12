// The scripted agents (T-391): a fixed sequence of tool calls for each side of each scenario, played by the
// scripted provider through the same loop, tools, world and record as a live model. They prove the harness: that
// the runner, the fences, the record, the measures and the replay page work end to end. They prove nothing about
// whether a model can do the deal from the docs; only a live run shows that.
import type { ScriptContext, ScriptStep } from './providers.ts';
import { BUDGET, SCOPE, type ScenarioName } from './scenarios.ts';

export interface ScriptFacts {
  docs: { guide: string; sell: string };
  sellerPage: string;
  jobApi: { quote: string; start: string; result: string; url: string };
  adapterPort: number;
  keyStore: string;
  /** An operator, for reading a deal's state. */
  operator: string;
}

const call = (name: string, input: Record<string, unknown>) => ({ name, input });
const ID = /(0x[0-9a-f]{64})/;

/** Polls: repeats the step before it (one call) until `ready` holds, at most `times` times, then goes on anyway. */
function until(ready: (c: ScriptContext) => boolean, times = 120): ScriptStep {
  let n = 0;
  return (c) => (ready(c) || ++n >= times ? { calls: [call('wait', { seconds: 1 })] } : 'again');
}

export function sellerScript(s: ScenarioName, f: ScriptFacts): ScriptStep[] {
  const adapter = `http://127.0.0.1:${f.adapterPort}`;
  const config = {
    port: f.adapterPort,
    sellerApi: { quote: f.jobApi.quote, start: f.jobApi.start, result: f.jobApi.result },
    pollMs: 500,
    redelivery: { refetchEverySec: 600 },
    ...(s === 'bad-offer' ? { termsRules: [{ when: [], dropChecks: ['coverage'] }] } : {}),
  };
  const card = { type: 'crow-agent', name: 'Audit reports', offers: [{ id: 'audit-report', description: 'A security audit report of smart contract files at one commit', pricing: { kind: 'quoted', quote: `${adapter}/quote`, defaults: `${adapter}/defaults` } }] };
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Audit reports</title></head><body><h1>Audit reports for smart contracts</h1><p>Priced by quote, sold through Crow.</p><script type="application/json" id="crow-agent">${JSON.stringify(card)}</script></body></html>`;
  let id = '';
  let polls = 0;
  const steps: ScriptStep[] = [
    () => ({ text: 'I read the agent guide and the seller\'s page first.', calls: [call('fetch_url', { url: f.docs.guide }), call('fetch_url', { url: f.docs.sell })] }),
    () => ({ text: 'I write the adapter\'s configuration with our job API and the port my owner opened, and start it.', calls: [call('write_file', { path: 'seller.json', content: JSON.stringify(config, null, 2) }), call('run_command', { command: 'seller-adapter', args: ['seller.json'] })] }),
    () => ({ text: 'I publish our card, so a buyer can find the quote address.', calls: [call('write_file', { path: 'public/index.html', content: page }), call('write_file', { path: 'public/agent.json', content: JSON.stringify(card, null, 2) })] }),
    // Wait for a buyer's quote: the adapter logs "<id> is offered to …".
    () => ({ calls: [call('run_command', { command: 'adapter-log', args: [] })] }),
    (c) => {
      const got = c.history.flatMap((t) => (t.role === 'results' ? t.results.map((r) => r.content) : [])).map((r) => /(0x[0-9a-f]{64}) is offered to/.exec(r)?.[1]).find(Boolean);
      if (!got) return ++polls > 240 ? { calls: [call('finish', { outcome: 'No buyer asked for a quote', report: 'No quote came in.' })] } : 'again';
      id = got;
      return { text: `A buyer asked for a quote: ${id} is offered. I watch the deal.`, calls: [call('wait', { seconds: 1 })] };
    },
  ];
  if (s === 'refund') {
    steps.push(
      () => ({ calls: [call('run_command', { command: 'adapter-log', args: [] })] }),
      until((c) => c.results().some((r) => /ALERT 0x[0-9a-f]{64} delivery\.refused/.test(r))),
      () => ({ text: 'The adapter held our report back: its own check run refused it. My owner\'s rule is to deliver it as it is, so I fetch it and deliver it by hand.', calls: [call('fetch_url', { url: f.jobApi.result.replace('{jobId}', 'job-1') })] }),
      (c) => {
        const r = c.results().at(-1) ?? '';
        const body = r.slice(r.indexOf('\n\n') + 2);
        return { calls: [call('write_file', { path: 'report.json', content: body }), call('run_command', { command: 'seal', args: ['seller-adapter.journal.json', 'report.json', id] })] };
      },
    );
  }
  if (s === 'bad-offer') {
    // The buyer should walk away: wait a while for a hold that never comes, then report.
    let n = 0;
    steps.push(
      () => ({ calls: [call('fetch_url', { url: `${f.operator}/v1/commitments/${id}` })] }),
      (c) => (/"escrowState":"(Held|Delivered|Released|Refunded)"/.test(c.results().at(-1) ?? '') || ++n > 5 ? { calls: [call('finish', { outcome: /"escrowState":"Held"/.test(c.results().at(-1) ?? '') ? 'Funded' : 'Not funded', report: `The buyer did not fund ${id}; the offer stays unfunded.` })] } : 'again'),
    );
    return steps;
  }
  steps.push(
    () => ({ calls: [call('fetch_url', { url: `${f.operator}/v1/commitments/${id}` })] }),
    until((c) => /"escrowState":"(Released|Refunded)"/.test(c.results().at(-1) ?? ''), 600),
    (c) => ({ text: `The deal ended ${c.find(/"escrowState":"(Released|Refunded)"/) ?? 'unknown'}. I keep its record.`, calls: [call('run_command', { command: 'deal-record', args: [id, '--as', 'seller', '--out', 'deal-record.json'] })] }),
    (c) => ({ calls: [call('finish', { outcome: c.find(/"escrowState":"(Released|Refunded)"/) ?? 'unknown', report: `Deal ${id}; the deal record is in deal-record.json.` })] }),
  );
  return steps;
}

export function buyerScript(s: ScenarioName, f: ScriptFacts): ScriptStep[] {
  let quote = '';
  let defaults = '';
  let id = '';
  let tries = 0;
  const steps: ScriptStep[] = [
    () => ({ text: 'I read the agent guide and the seller\'s page of the docs, then the seller\'s own page.', calls: [call('fetch_url', { url: f.docs.guide }), call('fetch_url', { url: f.docs.sell })] }),
    () => ({ calls: [call('fetch_url', { url: f.sellerPage })] }),
    (c) => {
      const page = c.results().at(-1) ?? '';
      if (!page.startsWith('HTTP 200')) return ++tries > 240 ? { calls: [call('finish', { outcome: 'No seller page', report: 'The seller\'s page never appeared.' })] } : 'again';
      const card = JSON.parse(/<script type="application\/json" id="crow-agent">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '{}');
      quote = card.offers?.[0]?.pricing?.quote ?? '';
      defaults = card.offers?.[0]?.pricing?.defaults ?? '';
      return { text: `The seller's card lists a quoted audit report at ${quote}. I ask its signer for a quote, which stops before it signs anything.`, calls: [call('run_command', { command: 'buy-with-signer', args: [quote, f.keyStore, JSON.stringify(SCOPE), BUDGET, defaults] })] };
    },
    (c) => {
      const r = c.results().at(-1) ?? '';
      id = /"approval":"needed".*?"commitmentId":"(0x[0-9a-f]{64})"/.exec(r)?.[1] ?? ID.exec(r)?.[1] ?? '';
      const offer = /(\{"approval":"needed"[^\n]*\})/.exec(r)?.[1];
      const checks: Array<{ id: string; required: boolean }> = offer ? JSON.parse(offer).checks ?? [] : [];
      const missing = ['coverage', 'scope'].filter((k) => !checks.some((x) => x.id === k && x.required));
      if (missing.length) return { text: `The offer has no required ${missing.join(' or ')} check, which my owner requires. I refuse it: nothing is signed or paid.`, calls: [call('finish', { outcome: 'Refused the offer', report: `Offer ${id} drops the required check ${missing.join(', ')}; my owner requires it. Nothing was signed or paid.` })] };
      return { text: `The offer matches my brief: within budget, with the coverage and scope checks. I approve it.`, calls: [call('run_command', { command: 'buy-with-signer', args: ['approve', f.keyStore, id, BUDGET] })] };
    },
    (c) => {
      const r = c.results().at(-1) ?? '';
      const outcome = /"outcome":"(released|refunded)"/i.exec(r)?.[1] ?? 'unknown';
      return { calls: [call('finish', { outcome, report: `Deal ${id} ended ${outcome}.` })] };
    },
  ];
  return steps;
}
