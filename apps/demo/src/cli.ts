// pnpm demo [--beat n] [--live] [--out dir]
// Runs the beats, prints the narration, and writes demo/out/beat-<n>.md, beat-<n>.json, closing.md and
// index.html. Scripted judges by default, with no keys. --live (T-028) seats config/judges-live.yaml and calls
// the models, given HOLDBACK_ANTHROPIC_API_KEY, HOLDBACK_OPENAI_COMPATIBLE_API_KEY and
// HOLDBACK_OPENAI_COMPATIBLE_BASE_URL in `io.env` (bin.ts passes the environment for --live only); without them it
// refuses and names what is missing. Values are never printed.
import { liveJudges, liveRegistry, LIVE_REGISTRY_URI, missingLiveEnv, type JudgeUsage } from '@holdback/adjudicator';
import { useLiveJudges } from '@holdback/demo/agents/bench.js';
import type { JudgeProvider } from '@holdback/judgment';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoSource } from './source/demo.js';
import { beatHeader, narrate, sharedHeader, type SharedHeader } from './transcript/narrate.js';
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

export const USAGE = 'usage: pnpm demo [--beat <n>] [--out <dir>] [--live]   (scripted judges; --live calls models from two families and needs their keys)';

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
  /** The environment, for --live only: the live providers read their keys from it. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Stands in for the live models (tests): --live runs as if the keys reached real providers. */
  liveProvider?: JudgeProvider;
}

export const liveRefusal = (missing: readonly string[]) =>
  [
    `pnpm demo --live needs ${missing.join(', ')}.`,
    'Live mode calls judges from two model families (Anthropic, and DeepSeek through an OpenAI-compatible API); set the variables in the environment or in the git-ignored .env at the repository root.',
    'Run `pnpm demo` for scripted mode: the same beats with scripted judges and no keys.',
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
  if (!args.live) return run(args, io, now, started);
  const env = io.env ?? {};
  const usage: JudgeUsage[] = [];
  const live = io.liveProvider ? { ok: true as const, value: io.liveProvider } : liveJudges(env, { onUsage: (u) => usage.push(u) });
  if (!live.ok) {
    io.error(liveRefusal(missingLiveEnv(env).length ? missingLiveEnv(env) : [live.error]));
    return 2;
  }
  let calls = 0;
  useLiveJudges({ registry: liveRegistry(), registryUri: LIVE_REGISTRY_URI, provider: { complete: (r) => (calls++, live.value.complete(r)) } });
  try {
    const code = await run(args, io, now, started);
    io.log(`Live judge calls: ${calls}.${usage.length ? ` Tokens by model (input/output): ${tokensByModel(usage)}.` : ''}`);
    return code;
  } finally {
    useLiveJudges(undefined);
  }
}

const tokensByModel = (usage: readonly JudgeUsage[]): string => {
  const by = new Map<string, [number, number, number]>();
  for (const u of usage) {
    const t = by.get(u.model) ?? [0, 0, 0];
    by.set(u.model, [t[0] + 1, t[1] + u.inputTokens, t[2] + u.outputTokens]);
  }
  return [...by].map(([m, [n, i, o]]) => `${m} ${n} call${n === 1 ? '' : 's'} ${i}/${o}`).join('; ');
};

async function run(args: Args, io: Io, now: () => number, started: number): Promise<number> {
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
  let shared: SharedHeader | undefined;
  for (const beat of args.beat === undefined ? available : [args.beat]) {
    const t = await source.run(beat);
    writeFileSync(join(outDir, `beat-${beat}.md`), renderMarkdown(t));
    writeFileSync(join(outDir, `beat-${beat}.json`), renderJson(t));
    firstMs ??= Math.round(now() - started);
    transcripts.push(t);
    // Terminal: every line is plain (no escape sequences, bidi or tag characters, no embedded line breaks).
    // The first beat's mode, source and units print once; later beats print only what differs (T-019).
    shared ??= sharedHeader([t]);
    if (transcripts.length === 1) for (const line of shared.lines) io.log(plain(line));
    io.log(`\nBeat ${t.beat}: ${plain(t.title)}`);
    for (const line of beatHeader(t, shared)) io.log(`  ${plain(line)}`);
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
