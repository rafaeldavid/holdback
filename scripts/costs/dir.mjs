// The two output directories (T-052, step 3). CROW_COSTS_DIR holds billing figures; CROW_TELEMETRY_DIR holds
// what the agent-ops phase may read (T-031's day lines, no figure). Both are required, given as full paths, and
// outside every git checkout and git directory: inside one, an agent working there could read the figures, and
// a linked worktree's files go with the worktree.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { git } from './approved.mjs';

export class DirRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'DirRefused';
  }
}

function inside(parent, child) {
  const r = relative(parent, child);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
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

/** Validates one directory variable and returns its real path. Throws DirRefused. */
export function checkDir(name, value, cloneRoot) {
  if (!value) throw new DirRefused(`${name} is not set; give a full path outside every checkout`);
  if (!isAbsolute(value)) throw new DirRefused(`${name} must be a full path (Node does not expand ~)`);
  const asGiven = normalize(value);
  const base = nearestExisting(asGiven);
  // Compare real paths: git reports them, and macOS temp and home paths often pass through symlinks.
  const dir = join(realpathSync(base), relative(base, asGiven));
  if (inside(realpathSync(cloneRoot), dir)) throw new DirRefused(`${name} is inside the clone; keep figures outside it`);
  if (git(['rev-parse', '--is-inside-work-tree'], base).stdout === 'true') throw new DirRefused(`${name} is inside a git checkout; keep figures outside every checkout`);
  if (git(['rev-parse', '--is-inside-git-dir'], base).stdout === 'true') throw new DirRefused(`${name} is inside a git directory`);
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
