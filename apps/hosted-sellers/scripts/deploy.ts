// `node apps/hosted-sellers/scripts/deploy.ts --seller <private folder> --workspace <id|none> [--first | --check-only | --dry-run]`
// (T-436): deploys one hosted seller's Worker, crow-seller-<slug>, from a detached worktree at origin/main, and checks
// it. Deploys wait for Rafa. The steps are in src/deploy-plan.ts (deploySeller); docs/operations.md, "Hosted sellers",
// has the first deploy's runbook.
import { checkout, liveVersion, recordLine, rollback, sh } from '../../../scripts/deploy-lib.mjs';
import { deploySeller } from '../src/deploy-plan.ts';
import { main, probe, readSeller, shell, writeGenerated } from './effects.ts';

process.exit(
  await deploySeller({
    args: process.argv.slice(2),
    readSeller,
    writeGenerated,
    main,
    sh: shell,
    checkout: (command) => checkout(command, sh),
    liveVersion: (name) => liveVersion(name, sh),
    rollback: (name, version, message) => rollback(name, version, message, sh),
    recordLine,
    probe,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  }),
);
