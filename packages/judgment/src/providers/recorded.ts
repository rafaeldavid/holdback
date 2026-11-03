// Recorded judges: replay a verdict only for the same pinned model and the same rendered prompt
// (inputHash = SHA-256 of the RFC 8785 JSON of {system, user}, the hash the judgment record carries).
// A changed template, rubric, sample, seed or deliverable changes the input, so nothing stale replays.
import { createHash } from 'node:crypto';
import { canonicalJson, type Hex32 } from '@holdback/core';
import type { JudgeProvider, JudgeRequest, JudgeResponse } from '../pipeline.js';

export interface JudgeRecording {
  judgeId: string;
  model: string;
  inputHash: Hex32;
  /** The raw model output, parsed and filtered by the pipeline as if live. */
  text: string;
  latencyMs?: number;
}

export const requestInputHash = (req: Pick<JudgeRequest, 'system' | 'user'>): Hex32 =>
  `0x${createHash('sha256').update(canonicalJson({ system: req.system, user: req.user })).digest('hex')}`;

const keyOf = (model: string, inputHash: string) => `${model}|${inputHash}`;

export function recordedProvider(recordings: readonly JudgeRecording[]): JudgeProvider {
  const byKey = new Map(recordings.map((r) => [keyOf(r.model, r.inputHash), r]));
  return {
    async complete(req): Promise<JudgeResponse> {
      const r = byKey.get(keyOf(req.model, requestInputHash(req)));
      if (!r) return { kind: 'error', transport: false, detail: `no recording for ${req.judgeId} (${req.model}) and this input` };
      return r.latencyMs === undefined ? { kind: 'ok', text: r.text } : { kind: 'ok', text: r.text, latencyMs: r.latencyMs };
    },
  };
}

/** Wraps a provider and keeps every ok answer as a recording. */
export function recorder(inner: JudgeProvider): { provider: JudgeProvider; recordings: JudgeRecording[] } {
  const recordings: JudgeRecording[] = [];
  return {
    recordings,
    provider: {
      async complete(req) {
        const res = await inner.complete(req);
        if (res.kind === 'ok') {
          recordings.push({ judgeId: req.judgeId, model: req.model, inputHash: requestInputHash(req), text: res.text, ...(res.latencyMs !== undefined ? { latencyMs: res.latencyMs } : {}) });
        }
        return res;
      },
    },
  };
}
