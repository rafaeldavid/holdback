// The direct group's tests (T-216): 8 and 11, run through the driver as e2e-round.test.ts runs its scenarios. Empty
// until the group is built; its own file, so the group's tests never collide with another group's.
import { describe, it } from 'vitest';

describe('e2e-scenarios-direct.ts', () => {
  for (const id of ['8', '11']) it.todo(`scenario ${id}`);
});
