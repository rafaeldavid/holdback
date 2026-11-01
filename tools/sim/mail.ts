// The agent-to-agent channel of a run: one directory per party under runs/<run-id>/mailbox/. Messages are
// files; nothing authenticates the sender, as with any channel outside the protocol. Reading moves a message
// to read/, so each is delivered once.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Mail {
  from: string;
  to: string;
  at: string;
  subject: string;
  body: string;
}

let counter = 0;

export function send(mailRoot: string, m: Omit<Mail, 'at'>): string {
  const box = join(mailRoot, m.to);
  if (!existsSync(box)) throw new Error(`no mailbox for ${m.to}`);
  const at = new Date().toISOString();
  const name = `${at.replace(/[:.]/g, '-')}-${process.pid}-${counter++}-${m.from}.json`;
  writeFileSync(join(box, `.${name}`), JSON.stringify({ ...m, at }, null, 2));
  renameSync(join(box, `.${name}`), join(box, name)); // appears whole or not at all
  return name;
}

/** The oldest unread message, moved to read/, or null. */
export function receive(mailRoot: string, me: string): Mail | null {
  const box = join(mailRoot, me);
  if (!existsSync(box)) throw new Error(`no mailbox for ${me}`);
  const next = readdirSync(box)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .sort()[0];
  if (!next) return null;
  mkdirSync(join(box, 'read'), { recursive: true });
  renameSync(join(box, next), join(box, 'read', next));
  return JSON.parse(readFileSync(join(box, 'read', next), 'utf8')) as Mail;
}

export async function receiveWaiting(mailRoot: string, me: string, waitSec: number): Promise<Mail | null> {
  const until = Date.now() + waitSec * 1000;
  for (;;) {
    const m = receive(mailRoot, me);
    if (m || Date.now() >= until) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
}
