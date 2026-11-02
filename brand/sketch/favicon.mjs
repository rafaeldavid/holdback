// The favicon: the crow's head (an RGBA crop of Thorburn's 1919 pencil crow) inked darker and set on a white
// rounded tile, so it reads on light and dark browser tabs alike.
// Usage: node brand/sketch/favicon.mjs <crow-head.png> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const [, , src, dst] = process.argv;

// Decode an 8-bit RGBA, non-interlaced PNG (the only kind lift.mjs writes).
function decode(buf) {
  let p = 8, W = 0, H = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(W * H * 4), stride = W * 4;
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0, b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + i] = (line[i] + pred) & 0xff;
    }
  }
  return { W, H, px: out };
}

const { W, H, px } = decode(readFileSync(src));
const S = 128, PAD = 6, R = 26, ink = [0x1a, 0x19, 0x17];
const scale = (S - 2 * PAD) / Math.max(W, H);
// Coverage of the rounded square at (x, y), 4x4 supersampled for a smooth edge.
const tile = (x, y) => {
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const u = x + (i + 0.5) / 4, v = y + (j + 0.5) / 4;
    const dx = Math.max(R - u, u - (S - R), 0), dy = Math.max(R - v, v - (S - R), 0);
    if (dx * dx + dy * dy <= R * R) n++;
  }
  return n / 16;
};
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    // Box-filter the source area under this output pixel.
    const x0 = (x - PAD) / scale, x1 = (x + 1 - PAD) / scale, y0 = (y - PAD) / scale, y1 = (y + 1 - PAD) / scale;
    let a = 0, n = 0;
    for (let sy = Math.max(0, Math.floor(y0)); sy < Math.min(H, Math.ceil(y1)); sy++)
      for (let sx = Math.max(0, Math.floor(x0)); sx < Math.min(W, Math.ceil(x1)); sx++) {
        const i = (sy * W + sx) * 4, l = (px[i] + px[i + 1] + px[i + 2]) / 765;
        a += (px[i + 3] / 255) * (1 - l * 0.6); n++;
      }
    // Darken the pencil so the head survives at 16 px.
    a = n ? Math.min(1, Math.pow(a / n, 0.7) * 1.5) : 0;
    const o = y * (S * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(255 * (1 - a) + ink[c] * a);
    raw[o + 3] = Math.round(255 * tile(x, y));
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
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(dst, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`${dst}: ${S}x${S}`);
