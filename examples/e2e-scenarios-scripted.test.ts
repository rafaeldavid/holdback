// The scripted-adjudicator group's tests (T-216): 3c and 7, run through the driver as e2e-round.test.ts runs its
// scenarios. Empty until the group is built; its own file, so the group's tests never collide with another group's.
import { describe, it } from 'vitest';

describe('e2e-scenarios-scripted.ts', () => {
  for (const id of ['3c', '7']) it.todo(`scenario ${id}`);
});
