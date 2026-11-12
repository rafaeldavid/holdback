// How a command in examples/ knows it is the program being run, and how it names itself and its siblings in the
// lines it prints (T-390 part 3, for T-393's one-file buyer bundle).
//
// Unbundled, nothing changes: a file is the program when `node examples/<file>.ts` runs it, and a command names a
// sibling as `node examples/<sibling>.ts`, relative to where it runs. A bundle that inlines several of these files
// declares, before its modules run (a banner):
//   globalThis.crowEntry     the name of the one command it runs, such as 'buy-with-signer'; every other file it
//                            inlines (deal-record.ts, imported by buyer-signer.ts) then runs no main of its own;
//   globalThis.crowCommands  how a person runs each command it holds, such as
//                            { 'buy-with-signer': 'node buy.mjs', 'pay-from-wallet': 'node buy.mjs pay' }.
// Both are the bundle's own words about itself; no message, file or server sets them.
import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Declared = { crowEntry?: unknown; crowCommands?: unknown };
const declared = () => globalThis as unknown as Declared;

/**
 * Whether the module at `metaUrl`, a command named `name` (its file name without `.ts`), is the program being run.
 * In a bundle that declares `crowEntry`, only the command it names is; otherwise the file `node` was given is.
 */
export function isMain(metaUrl: string, name: string): boolean {
  const entry = declared().crowEntry;
  if (entry !== undefined) return entry === name;
  return Boolean(process.argv[1]) && metaUrl === pathToFileURL(process.argv[1]!).href;
}

/** A path as a shell reads it: as it is when it holds only safe characters, else in single quotes. */
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/**
 * How a person runs the command `name` (a file in examples/, without `.ts`), as text to print: the bundle's own words
 * when it declares `crowCommands[name]`, else `node <path of examples/<name>.ts, relative to where this runs>`.
 * `from` is the caller's `import.meta.url`, which locates examples/ unbundled.
 */
export function command(name: string, from: string): string {
  const named = declared().crowCommands;
  if (named !== null && typeof named === 'object' && typeof (named as Record<string, unknown>)[name] === 'string') return (named as Record<string, string>)[name]!;
  return `node ${sh(relative(process.cwd(), fileURLToPath(new URL(`./${name}.ts`, from))))}`;
}
