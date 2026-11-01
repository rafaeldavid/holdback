// node:fs for the bundled Worker (wrangler alias): read-only access to the repository files embedded by
// scripts/embed.mjs, matched by their path from the repository root. Anything else does not exist. The
// bundle's import.meta.url is a fixed file URL (wrangler define), so modules resolve their usual relative
// paths (../../../spec/schemas/ and the like) to paths ending in those repository paths.
import { FILES } from './generated-files.js';

const pathOf = (p) => (p instanceof URL ? p.pathname : String(p).startsWith('file:') ? new URL(String(p)).pathname : String(p)).replace(/\/+$/, '');
const fileFor = (p) => {
  const path = pathOf(p);
  return Object.keys(FILES).find((k) => path === `/${k}` || path.endsWith(`/${k}`));
};
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${pathOf(p)}'`), { code: 'ENOENT' });

export function readFileSync(p, options) {
  const k = fileFor(p);
  if (!k) throw enoent(p);
  const text = FILES[k];
  return options === undefined || options === null ? new TextEncoder().encode(text) : text;
}

export function readdirSync(p) {
  const dir = pathOf(p);
  const names = new Set();
  for (const k of Object.keys(FILES)) {
    const parent = k.slice(0, k.lastIndexOf('/'));
    if (dir === `/${parent}` || dir.endsWith(`/${parent}`)) names.add(k.slice(k.lastIndexOf('/') + 1));
  }
  if (names.size === 0) throw enoent(p);
  return [...names].sort();
}

export function existsSync(p) {
  return fileFor(p) !== undefined;
}

export const constants = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOFOLLOW: 131072 };

export default { readFileSync, readdirSync, existsSync, constants };
