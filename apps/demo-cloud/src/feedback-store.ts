// The demo operator's private report store (T-032): a Workers KV namespace bound as FEEDBACK on holdback-op1. Keys
// `fb:<id>` hold a report, `fp:<fingerprint>` the first report with that fingerprint; both expire after the
// retention period. Triage reads and replies with wrangler (apps/demo-cloud/scripts/feedback.mjs, docs/operations.md).
import { RETENTION_DAYS, type FeedbackStore, type StoredReport } from '@holdback/operator';
import type { Hex32 } from '@holdback/core';

/** The slice of the Workers KV binding the store uses. */
export interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const TTL_SEC = RETENTION_DAYS * 86_400;

export class KvFeedbackStore implements FeedbackStore {
  constructor(private readonly kv: KvNamespace) {}

  async get(id: string): Promise<StoredReport | undefined> {
    const v = await this.kv.get(`fb:${id}`);
    return v === null ? undefined : (JSON.parse(v) as StoredReport);
  }

  async firstWith(fingerprint: Hex32): Promise<string | undefined> {
    return (await this.kv.get(`fp:${fingerprint}`)) ?? undefined;
  }

  async add(report: StoredReport): Promise<void> {
    await this.kv.put(`fb:${report.id}`, JSON.stringify(report), { expirationTtl: TTL_SEC });
    if (!report.duplicateOf) await this.kv.put(`fp:${report.fingerprint}`, report.id, { expirationTtl: TTL_SEC });
  }
}
