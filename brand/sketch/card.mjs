// The 1200x630 social card for escrow.stream: Thorburn's pencil crow (public domain, 1919) centred on the site's paper.
// Usage: node brand/sketch/card.mjs <bird.bmp> <out.png>   (the BMP is the same crop lift.mjs reads)
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
const hist = new Array(256).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hist[Math.round(lum(x, y))]++;
let acc = 0, paperLum = 255;
for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > W * H * 0.6) { paperLum = v; break; } }

const CW = 1200, CH = 630, paper = [0xfa, 0xf7, 0xf0], ink = [0x2f, 0x2d, 0x2a];
const scale = Math.min((CW * 0.78) / W, (CH * 0.82) / H);
const dw = Math.round(W * scale), dh = Math.round(H * scale), ox = Math.round((CW - dw) / 2), oy = Math.round((CH - dh) / 2);
const LIFT = paperLum - 6, DARK = 60;
const raw = Buffer.alloc((CW * 3 + 1) * CH);
for (let y = 0; y < CH; y++) {
  raw[y * (CW * 3 + 1)] = 0;
  for (let x = 0; x < CW; x++) {
    let a = 0;
    const sx = Math.floor((x - ox) / scale), sy = Math.floor((y - oy) / scale);
    if (x >= ox && y >= oy && sx < W && sy < H) a = Math.pow(Math.max(0, Math.min(1, (LIFT - lum(sx, sy)) / (LIFT - DARK))), 0.9);
    const o = y * (CW * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(paper[c] * (1 - a) + ink[c] * a);
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
ihdr.writeUInt32BE(CW, 0); ihdr.writeUInt32BE(CH, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(dst, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`${dst}: ${CW}x${CH}`);
