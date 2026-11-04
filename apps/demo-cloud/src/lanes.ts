// The relayer lanes' in-flight rows (T-219) in the world's Durable Object storage. A deal lane writes one row before
// each broadcast, under `lane:<lane>:<sender>:<nonce>`, and the world deletes it once the books its receipt changed
// are written. Opening reads every open row with one list: one row read when none is open, one per open row otherwise.
// A lane sends one transaction at a time, so that is at most one row per lane, except in the moment between one
// receipt and the write of its books (live.ts), or while a rotated relayer key's lane still has the old key's row.
import type { LaneRow, LaneStore } from '@holdback/settlement/live';
import type { WorldStorage } from './storage.js';

export const LANE_PREFIX = 'lane:';

/**
 * A row's key: the lane, the sender (as LiveChain keys its rows, so a rotated relayer key's row at the same lane and
 * nonce is another row; red-team, 2026-11-04), then the nonce, zero-padded so the rows list in nonce order.
 */
export const laneRowKey = (r: Pick<LaneRow, 'lane' | 'from' | 'nonce'>): string => `${LANE_PREFIX}${r.lane}:${r.from.toLowerCase()}:${String(r.nonce).padStart(12, '0')}`;

export class StorageLanes implements LaneStore {
  constructor(private readonly storage: WorldStorage) {}

  async load(): Promise<LaneRow[]> {
    return [...(await this.storage.list<LaneRow>({ prefix: LANE_PREFIX })).values()];
  }

  async write(row: LaneRow): Promise<void> {
    await this.storage.put({ [laneRowKey(row)]: row });
  }

  async remove(rows: readonly LaneRow[]): Promise<void> {
    if (rows.length > 0) await this.storage.delete(rows.map(laneRowKey));
  }
}
