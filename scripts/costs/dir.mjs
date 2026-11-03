// The two output directories (T-052, step 3). CROW_COSTS_DIR holds billing figures; CROW_TELEMETRY_DIR holds
// what the agent-ops phase may read (T-031's day lines, no figure). Both are required, absolute, outside the
// clone, git-ignored if inside another checkout, and never inside a linked worktree, whose files go with it.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { git } from './approved.mjs';

export class DirRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'DirRefused';
  }
}

function inside(parent, child) {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

function nearestExisting(path) {
  let p = path;
  while (!existsSync(p)) {
    const up = dirname(p);
    if (up === p) return p;
    p = up;
  }
  return p;
}

/** Validates one directory variable and returns its normalized path. Throws DirRefused. */
export function checkDir(name, value, cloneRoot) {
  if (!value) throw new DirRefused(`${name} is not set; give a full path outside the clone`);
  if (!isAbsolute(value)) throw new DirRefused(`${name} must be a full path (Node does not expand ~)`);
  const asGiven = normalize(value);
  const base = nearestExisting(asGiven);
  // Compare real paths: git reports them, and macOS temp and home paths often pass through symlinks.
  const dir = join(realpathSync(base), relative(base, asGiven));
  if (inside(realpathSync(cloneRoot), dir)) throw new DirRefused(`${name} is inside the clone; keep figures outside it`);
  const top = git(['rev-parse', '--show-toplevel'], base);
  if (top.status === 0 && top.stdout) {
    const gitDir = git(['rev-parse', '--absolute-git-dir'], base).stdout;
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], base).stdout;
    if (gitDir && common && normalize(gitDir) !== normalize(common)) throw new DirRefused(`${name} is inside a linked worktree, which goes when the worktree does`);
    if (git(['check-ignore', '-q', '--no-index', dir], top.stdout).status !== 0) throw new DirRefused(`${name} is inside a git checkout and not git-ignored there`);
  }
  return dir;
}

/** Both directories, validated and created. */
export function resolveDirs(env, cloneRoot) {
  const costsDir = checkDir('CROW_COSTS_DIR', env.CROW_COSTS_DIR, cloneRoot);
  const telemetryDir = checkDir('CROW_TELEMETRY_DIR', env.CROW_TELEMETRY_DIR, cloneRoot);
  if (inside(costsDir, telemetryDir) || inside(telemetryDir, costsDir)) throw new DirRefused('CROW_COSTS_DIR and CROW_TELEMETRY_DIR must not contain each other');
  mkdirSync(costsDir, { recursive: true, mode: 0o700 });
  mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
  return { costsDir, telemetryDir };
}
