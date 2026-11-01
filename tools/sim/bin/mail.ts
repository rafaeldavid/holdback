// The parties' mailbox (agent to agent, outside the protocol; unauthenticated).
//   node tools/sim/bin/mail.ts send <run-id> <from> <to> <file> [--subject "<text>"]
//   node tools/sim/bin/mail.ts read <run-id> <me> [--wait <seconds>]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { receiveWaiting, send } from '../mail.ts';
import { RUNS_DIR, validRunId } from '../world.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [cmd, runId = ''] = args;
const usage = () => {
  console.error('usage: mail.ts send <run-id> <from> <to> <file> [--subject "<text>"] | mail.ts read <run-id> <me> [--wait <seconds>]');
  process.exit(2);
};
if (!validRunId(runId)) usage();
const root = join(RUNS_DIR, runId, 'mailbox');
try {
  if (cmd === 'send') {
    const [, , from, to, file] = args;
    if (!from || !to || !file || !validRunId(from) || !validRunId(to)) usage();
    const name = send(root, { from: from!, to: to!, subject: opt('subject') ?? '', body: readFileSync(file!, 'utf8') });
    console.log(`sent ${name} to ${to}`);
  } else if (cmd === 'read') {
    const me = args[2];
    if (!me || !validRunId(me)) usage();
    const wait = Number(opt('wait') ?? '0');
    if (!Number.isInteger(wait) || wait < 0 || wait > 600) usage();
    const m = await receiveWaiting(root, me!, wait);
    if (m) console.log(JSON.stringify(m, null, 2));
    else console.log('no unread mail');
  } else usage();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
