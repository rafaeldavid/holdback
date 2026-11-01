// Lift Thorburn's pencil hooded crow off the scanned page: paper becomes transparent, graphite stays.
// Source: Archibald Thorburn, "A naturalist's sketch book" (1919), plate 18, public domain
// (https://commons.wikimedia.org/wiki/File:A_naturalist%27s_sketch_book_(Plate_18)_BHL46157817.jpg).
// Usage: node brand/sketch/lift.mjs <in.bmp> <out.png>   (make the BMP with: sips -s format bmp in.jpg --out in.bmp)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [, , src, dst] = process.argv;
const buf = readFileSync(src);
const off = buf.readUInt32LE(10), W = buf.readInt32LE(18), Hs = buf.readInt32LE(22), bpp = buf.readUInt16LE(28);
const H = Math.abs(Hs), bottomUp = Hs > 0, step = bpp / 8, row = Math.ceil((W * bpp) / 32) * 4;
const lum = (x, y) => {
  const i = off + (bottomUp ? H - 1 - y : y) * row + x * step;
  return 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
};

// paper tone: the 90th percentile of luminance (most of the page is paper)
const hist = new Array(256).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hist[Math.round(lum(x, y))]++;
let acc = 0, paper = 255;
for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > W * H * 0.6) { paper = v; break; } }
const ink = [42, 42, 44], LIFT = paper - 6, DARK = 60;

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const a = Math.max(0, Math.min(1, (LIFT - lum(x, y)) / (LIFT - DARK)));
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = ink[0]; raw[o + 1] = ink[1]; raw[o + 2] = ink[2]; raw[o + 3] = Math.round(255 * Math.pow(a, 0.9));
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
writeFileSync(dst, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`${dst}: ${W}x${H}, paper ${paper}`);
