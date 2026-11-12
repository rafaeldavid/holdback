// Scratch copies of the contracts for the test-quality tools (T-352): coverage.mjs and mutate.mjs never build or
// change the checkout's own contracts/. Each run copies contracts/src, test, script, the build config and the drand
// fixtures into reports/scratch/t-352/<name>/ (git ignores reports/), from the working tree or from a git ref, and
// links contracts/lib to the checkout's own submodules, so nothing is downloaded.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this script lives in. */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
/** Every scratch copy lives under here; nothing is ever written or removed outside it. */
export const SCRATCH = join(ROOT, 'reports', 'scratch', 't-352');

/** What a copy carries, relative to the checkout: everything forge test reads except lib (linked) and out/cache. */
const INPUTS = [
  'contracts/src',
  'contracts/test',
  'contracts/script',
  'contracts/foundry.toml',
  'contracts/remappings.txt',
  'fixtures/beacon',
];

const LIB_PIN = 'contracts/lib/commerce-payments';

/**
 * Tests that fail under a build without the full optimizer for a reason that is not behaviour (measured on main at
 * 5a90dc5, 2026-11-11, under forge coverage --ir-minimum): they assert a gas cap that unoptimized code exceeds. The
 * fast builds of both tools skip them; mutate.mjs runs every survivor again on the full build with all tests.
 */
export const GAS_CAP_TESTS = [
  'test_attack_burn_unsignedDecisionWithAPointOutsideG1_costsItsRelayerTheCapAndLittleMore',
  'test_attack_forge_decompression_matchesNobleAtTheArithmeticEdges',
  'test_attack_forge_decompression_matchesNobleOnRandomPoints',
  'test_attack_forge_realSignaturePlusASmallOrderPoint_refusedByThePairing',
  'test_attack_forge_smallOrderPointsAlone_refusedByThePairing',
  'test_attack_forge_twoHundredCompressedStrings_refusedAtABoundedCost',
  'test_boundary_fork_aPairingThatAlwaysAnswersTrue_acceptsAPointOutsideG1',
  'test_review_gasOfOneVerification',
];
/** forge --no-match-test regex for GAS_CAP_TESTS (unanchored: forge 1.0 did not match them with `^(…)$`). */
export const GAS_CAP_REGEX = `(${GAS_CAP_TESTS.join('|')})`;

export const fail = (message) => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
};

const git = (args, opts = {}) =>
  execFileSync('git', ['-C', ROOT, ...args], { encoding: opts.encoding ?? 'utf8', maxBuffer: 1 << 30, ...opts });

/** Throws unless `path` is strictly inside the scratch root. */
export function assertInScratch(path) {
  const rel = relative(SCRATCH, resolve(path));
  if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`refusing to touch ${path}: it is not inside ${SCRATCH}`);
  }
}

/** sha256 of every file under contracts/src of the checkout, by relative path: the tools check it never changes. */
export function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

export const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The commit the checkout's contracts/lib submodule has checked out, or null when it is empty. */
function libCommit() {
  const lib = join(ROOT, LIB_PIN);
  if (!existsSync(join(lib, 'lib', 'forge-std', 'src'))) return null;
  return execFileSync('git', ['-C', lib, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/**
 * Makes a fresh copy at reports/scratch/t-352/<name>/ and returns its contracts/ directory.
 * ref: a git ref (branch, tag or commit) to copy from; null copies the working tree as it is, uncommitted edits too.
 */
export function prepareCopy(name, ref) {
  const lib = libCommit();
  if (!lib) {
    fail(
      `${LIB_PIN} is not checked out. Run the three submodule commands of the contracts job in .github/workflows/ci.yml first.`,
    );
  }
  let label = 'the working tree';
  let commit = null;
  if (ref) {
    try {
      commit = git(['rev-parse', '--verify', `${ref}^{commit}`], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      fail(`${ref} is not a commit here; fetch it first (git fetch origin ${ref})`);
    }
    const pin = git(['rev-parse', `${commit}:${LIB_PIN}`]).trim();
    if (pin !== lib) {
      fail(`${ref} pins ${LIB_PIN} at ${pin}, but this checkout has ${lib}; check out that pin first`);
    }
    label = `${ref} (${commit.slice(0, 12)})`;
  }

  const dest = join(SCRATCH, name);
  assertInScratch(dest);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  if (ref) {
    const tar = git(['archive', '--format=tar', commit, '--', ...INPUTS], { encoding: 'buffer' });
    execFileSync('tar', ['-x', '-C', dest], { input: tar });
  } else {
    for (const p of INPUTS) cpSync(join(ROOT, p), join(dest, p), { recursive: true });
  }
  symlinkSync(realpathSync(join(ROOT, 'contracts', 'lib')), join(dest, 'contracts', 'lib'), 'dir');
  if (!commit) commit = `${git(['rev-parse', 'HEAD']).trim()}+working-tree`;
  return { contracts: join(dest, 'contracts'), label, dest, commit };
}

/**
 * Takes reports/scratch/t-352/<name>.lock for this process, or stops when a live process holds it: two runs on one
 * copy would overwrite each other's mutants. The lock goes when the process exits.
 */
export function lock(name) {
  mkdirSync(SCRATCH, { recursive: true });
  const path = join(SCRATCH, `${name}.lock`);
  assertInScratch(path);
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = Number.isInteger(pid) && pid > 0;
    } catch {
      alive = false;
    }
    if (alive) fail(`another run (process ${pid}) holds ${path}; wait for it or stop it`);
    rmSync(path, { force: true });
  }
  writeFileSync(path, String(process.pid), { flag: 'wx' });
  process.on('exit', () => rmSync(path, { force: true }));
}

/** The sources a tool reports on: every .sol file of contracts/src in the copy, sorted. */
export function sources(contracts) {
  return readdirSync(join(contracts, 'src'))
    .filter((f) => f.endsWith('.sol'))
    .sort()
    .map((f) => `src/${f}`);
}

/** Reads `--name value` flags. */
export function flags(argv, known) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (!(key in known)) fail(`unknown flag ${a}; known: ${Object.keys(known).map((k) => `--${k}`).join(', ')}`);
    if (known[key] === 'bool') out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      out[key] = v;
    }
  }
  return out;
}
