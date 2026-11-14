// Crow's favicon set (T-428): the mark (site/crow-mark.svg), unchanged, in the kit's ink, centred on a plain white
// square, so it reads on a light and on a dark browser tab bar alike. One source, every size, no dependency: this file
// reads the mark's one path, writes the SVG, and draws each PNG itself (even-odd fill, 4 x 4 samples a pixel).
// Usage: node site/brand/icons.mjs        writes site/brand/icons/ (commit the result)
//        node site/brand/icons.mjs --check exits 1 when a committed file differs from what this script writes: the
//        text files byte for byte, the PNGs (and each PNG inside the .ico) by size and pixels, since zlib's compressed
//        bytes may differ between machines
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { ICON_FILES, TOKENS } from './kit.mjs';

const here = (f) => new URL(f, import.meta.url);
const WHITE = '#ffffff';
const INK = TOKENS.ink; // the mark's colour: the kit's ink
const VIEW = 24; // the mark's viewBox is 0 0 24 24
const MARGIN = 1.6; // white each side, in the mark's units: about 1 px at 16 px

const mark = readFileSync(here('../crow-mark.svg'), 'utf8');
const d = /<path[^>]*\sd="([^"]+)"/.exec(mark)?.[1];
if (!d || (mark.match(/<path/g) ?? []).length !== 1 || !/fill-rule="evenodd"/.test(mark)) throw new Error('site/crow-mark.svg changed shape: expected one even-odd path');

// The path as closed polygons: M starts one, Q is flattened into 8 segments, Z closes it. The mark uses only M, Q, Z.
function polygons(path) {
  const tokens = path.match(/[MQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi), out = [];
  let i = 0, cur = null, x = 0, y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === 'M') { x = num(); y = num(); cur = [[x, y]]; out.push(cur); }
    else if (c === 'Q') {
      const cx = num(), cy = num(), ex = num(), ey = num();
      for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; cur.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]); }
      x = ex; y = ey;
    } else if (c === 'Z') cur = null;
    else throw new Error(`site/crow-mark.svg uses "${c}": this script reads only M, Q and Z`);
  }
  return out;
}
const POLYS = polygons(d);
const xs = POLYS.flat().map((p) => p[0]), ys = POLYS.flat().map((p) => p[1]);
const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
// Fit the mark's own bounds inside the square less the margin, centred.
const fit = (VIEW - 2 * MARGIN) / Math.max(box.x1 - box.x0, box.y1 - box.y0);
const shift = [(VIEW - (box.x1 - box.x0) * fit) / 2 - box.x0 * fit, (VIEW - (box.y1 - box.y0) * fit) / 2 - box.y0 * fit];
const r = (n) => Math.round(n * 1000) / 1000;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}"><title>Crow</title><rect width="${VIEW}" height="${VIEW}" fill="${WHITE}"/><path transform="translate(${r(shift[0])} ${r(shift[1])}) scale(${r(fit)})" fill="${INK}" fill-rule="evenodd" d="${d}"/></svg>\n`;

// Coverage of the mark at each pixel of an S x S image, 0 to 1: 4 x 4 sample points a pixel, even-odd rule.
function coverage(S) {
  const N = 4, k = S / VIEW, edges = [];
  for (const poly of POLYS) for (let j = 0; j < poly.length; j++) {
    const a = poly[j], b = poly[(j + 1) % poly.length];
    edges.push([(a[0] * fit + shift[0]) * k, (a[1] * fit + shift[1]) * k, (b[0] * fit + shift[0]) * k, (b[1] * fit + shift[1]) * k]);
  }
  const cov = new Float64Array(S * S);
  for (let row = 0; row < S * N; row++) {
    const y = (row + 0.5) / N, cross = [];
    for (const [ax, ay, bx, by] of edges) if ((ay <= y) !== (by <= y)) cross.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    cross.sort((p, q) => p - q);
    for (let c = 0; c + 1 < cross.length; c += 2) {
      const from = Math.max(0, Math.ceil(cross[c] * N - 0.5)), to = Math.min(S * N - 1, Math.floor(cross[c + 1] * N - 0.5));
      for (let col = from; col <= to; col++) cov[Math.floor(row / N) * S + Math.floor(col / N)] += 1 / (N * N);
    }
  }
  return cov;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** An opaque S x S PNG (8-bit RGB): the ink blended onto white by coverage. */
function png(S) {
  const cov = coverage(S), ink = hex(INK), raw = Buffer.alloc(S * (S * 3 + 1));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.min(1, cov[y * S + x]), at = y * (S * 3 + 1) + 1 + x * 3;
    for (let ch = 0; ch < 3; ch++) raw[at + ch] = Math.round(255 * (1 - a) + ink[ch] * a);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** An .ico holding PNG images (every browser since 2010 reads PNG inside .ico). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([S, data], n) => {
    const e = 6 + 16 * n;
    head[e] = S % 256; head[e + 1] = S % 256; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(([, data]) => data)]);
}

const manifest = `${JSON.stringify({ name: 'Crow', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }], theme_color: TOKENS.page, background_color: WHITE, display: 'browser' }, null, 2)}\n`;

const p16 = png(16), p32 = png(32), p48 = png(48);
const files = {
  'favicon.svg': Buffer.from(svg),
  'favicon.ico': ico([[16, p16], [32, p32], [48, p48]]),
  'favicon-16.png': p16,
  'favicon-32.png': p32,
  'apple-touch-icon.png': png(180),
  'icon-192.png': png(192),
  'icon-512.png': png(512),
  'site.webmanifest': Buffer.from(manifest),
};
if (Object.keys(files).sort().join() !== [...ICON_FILES].sort().join()) throw new Error('kit.mjs ICON_FILES and this script name different files');

// What --check compares: a PNG's IHDR and its inflated pixel rows; an .ico's image count, sizes and those of each PNG.
const pngPixels = (buf) => {
  const parts = [];
  let ihdr = '', p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'IHDR') ihdr = buf.subarray(p + 8, p + 8 + len).toString('hex');
    if (type === 'IDAT') parts.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  return `${ihdr}:${inflateSync(Buffer.concat(parts)).toString('base64')}`;
};
const icoPixels = (buf) => Array.from({ length: buf.readUInt16LE(4) }, (_, n) => {
  const e = 6 + 16 * n, size = buf.readUInt32LE(e + 8), at = buf.readUInt32LE(e + 12);
  return `${buf[e]}x${buf[e + 1]}:${pngPixels(buf.subarray(at, at + size))}`;
}).join('|');
const same = (f, a, b) => {
  try {
    if (f.endsWith('.png')) return pngPixels(a) === pngPixels(b);
    if (f.endsWith('.ico')) return icoPixels(a) === icoPixels(b);
    return a.equals(b);
  } catch {
    return false;
  }
};

const dir = here('./icons/');
if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([f, data]) => { try { return !same(f, readFileSync(new URL(f, dir)), data); } catch { return true; } }).map(([f]) => f);
  if (stale.length) { console.error(`site/brand/icons/ is stale: ${stale.join(', ')}. Run node site/brand/icons.mjs and commit the result.`); process.exit(1); }
  console.log(`site/brand/icons/: ${Object.keys(files).length} files match the mark`);
} else {
  mkdirSync(dir, { recursive: true });
  for (const [f, data] of Object.entries(files)) writeFileSync(new URL(f, dir), data);
  console.log(`wrote ${Object.keys(files).length} files to site/brand/icons/`);
}
