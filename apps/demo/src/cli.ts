// pnpm demo [--beat n] [--live] [--out dir]
// Runs the beats, prints the narration, and writes demo/out/beat-<n>.md, beat-<n>.json, closing.md and
// index.html. Recorded mode only: --live refuses until two model-family keys exist. Reads no environment.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoSource } from './source/demo.js';
import { header, narrate } from './transcript/narrate.js';
import { renderHtml } from './transcript/render-html.js';
import { renderJson } from './transcript/render-json.js';
import { renderClosingMarkdown, renderMarkdown } from './transcript/render-md.js';
import type { BeatTranscript, EventSource } from './transcript/types.js';
import { plain } from './transcript/untrusted.js';

export interface Args {
  live: boolean;
  beat?: number;
  out?: string;
}

export const USAGE = 'usage: pnpm demo [--beat <n>] [--out <dir>]   (recorded mode; --live needs two model-family keys)';

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { live: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const [flag, inlineValue] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, undefined];
    const value = () => {
      const v = inlineValue ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--live':
        args.live = true;
        break;
      case '--beat': {
        const v = value();
        if (!/^[1-9]\d*$/.test(v)) throw new Error(`--beat needs a beat number, got "${v}"`);
        args.beat = Number.parseInt(v, 10);
        break;
      }
      case '--out':
        args.out = value();
        break;
      default:
        throw new Error(`unknown option ${raw}`);
    }
  }
  return args;
}

export interface Io {
  outDir: string;
  log: (line: string) => void;
  error: (line: string) => void;
  source?: EventSource;
  /** Milliseconds since some fixed origin; defaults to performance.now(). */
  now?: () => number;
}

export const LIVE_REFUSAL = [
  'pnpm demo --live is not available yet.',
  'Live mode calls judges from two model families and needs an API key for each, supplied as environment variables to the adjudicator. None is configured for this prototype.',
  'Run `pnpm demo` for recorded mode: the same beats with recorded verdicts and no keys.',
].join('\n');

/** Returns the process exit code: 0 on success, 2 on a usage error or refusal. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const now = io.now ?? (() => performance.now());
  const started = now();
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (args.live) {
    io.error(LIVE_REFUSAL);
    return 2;
  }
  const source = io.source ?? demoSource();
  const available = source.beats();
  if (args.beat !== undefined && !available.includes(args.beat)) {
    io.error(`no runner for beat ${args.beat}; available: ${available.join(', ')}`);
    return 2;
  }
  const outDir = args.out ?? io.outDir;
  mkdirSync(outDir, { recursive: true });

  const transcripts: BeatTranscript[] = [];
  let firstMs: number | undefined;
  for (const beat of args.beat === undefined ? available : [args.beat]) {
    const t = await source.run(beat);
    writeFileSync(join(outDir, `beat-${beat}.md`), renderMarkdown(t));
    writeFileSync(join(outDir, `beat-${beat}.json`), renderJson(t));
    firstMs ??= Math.round(now() - started);
    transcripts.push(t);
    // Terminal: every line is plain (no escape sequences, bidi or tag characters, no embedded line breaks).
    io.log(`\nBeat ${t.beat}: ${plain(t.title)}`);
    for (const line of header(t)) io.log(`  ${plain(line)}`);
    for (const e of t.events) if (e.kind !== 'balances') io.log(`  ${plain(narrate(e))}`);
  }
  const closing = renderClosingMarkdown();
  writeFileSync(join(outDir, 'closing.md'), closing);
  writeFileSync(join(outDir, 'index.html'), renderHtml(transcripts));
  io.log(`\n${closing}`);
  io.log(`Wrote ${transcripts.length} transcript${transcripts.length === 1 ? '' : 's'} to ${outDir} (source: ${source.name}); first transcript after ${firstMs ?? 0} ms, all in ${Math.round(now() - started)} ms.`);
  io.log(`Viewer: ${join(outDir, 'index.html')}`);
  return 0;
}
