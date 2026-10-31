// Fake judges for tests, fixtures and the recorded demo: deterministic, no network, no model.
// The default fake is honest-shaped: it scores every criterion the prompt names and passes.
import type { JudgeProvider, JudgeRequest, JudgeResponse } from '../pipeline.js';

const IDS_PREFIX = '6. "criteria" must contain each of these ids exactly once: ';

/** The criterion ids the first-instance or appeal template lists in rule 6. */
export function criterionIdsOf(system: string): string[] {
  const line = system.split('\n').find((l) => l.startsWith(IDS_PREFIX));
  if (!line) return [];
  const list = line.slice(IDS_PREFIX.length).replace(/\.$/, '');
  return list === '(none)' ? [] : list.split(', ');
}

/** A schema-valid verdict over the prompt's criteria. */
export function honestVerdict(req: JudgeRequest, overall: 'pass' | 'fail' = 'pass', score: 0 | 1 | 2 | 3 | 4 = overall === 'pass' ? 4 : 1): JudgeResponse {
  const criteria = criterionIdsOf(req.system).map((id) => ({ id, score, evidence: overall === 'pass' ? 'Meets the criterion in the rows shown.' : 'Falls short in the rows shown.' }));
  return { kind: 'ok', text: JSON.stringify({ criteria, overall, injectionSuspected: false, rationale: `fake judge: ${overall}` }), latencyMs: 1 };
}

export type FakeScript = Record<string, ((req: JudgeRequest) => JudgeResponse) | 'timeout' | 'pass' | 'fail'>;

/** Per judgeId: a function, 'pass', 'fail' or 'timeout'. Unscripted judges pass. */
export function fakeProvider(script: FakeScript = {}): JudgeProvider {
  return {
    async complete(req) {
      const s = script[req.judgeId] ?? 'pass';
      if (s === 'timeout') return { kind: 'timeout' };
      if (s === 'pass' || s === 'fail') return honestVerdict(req, s);
      return s(req);
    },
  };
}
