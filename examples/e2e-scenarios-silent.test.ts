// The silent-adjudicator group's tests (T-216): 3b, 4, 9 and 10b, run through the driver as e2e-round.test.ts runs its
// scenarios. Empty until the group is built; its own file, so the group's tests never collide with another group's.
import { describe, it } from 'vitest';

describe('e2e-scenarios-silent.ts', () => {
  for (const id of ['3b', '4', '9', '10b']) it.todo(`scenario ${id}`);
});
