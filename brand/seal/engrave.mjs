// Engrave the hooded crow photo into woodcut lines for the Crow seal.
// node reports/crow/engrave.mjs  ->  reports/crow/mask.bmp (debug) and reports/crow/crow.svg
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const PD = process.env.SRC === 'pd'; // the public-domain photo: Corvus_cornix_001.jpg by Yuriy75, Wikimedia Commons
const buf = readFileSync(here(PD ? '../crow-pd/small.bmp' : 'small.bmp'));
const off = buf.readUInt32LE(10), W = buf.readInt32LE(18), Hs = buf.readInt32LE(22), bpp = buf.readUInt16LE(28);
const H = Math.abs(Hs), bottomUp = Hs > 0, step = bpp / 8, row = Math.ceil((W * bpp) / 32) * 4;
const lum = new Float32Array(W * H), sat = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = off + (bottomUp ? H - 1 - y : y) * row + x * step;
  const b = buf[i], g = buf[i + 1], r = buf[i + 2];
  lum[y * W + x] = 0.299 * r + 0.587 * g + 0.114 * b;
  sat[y * W + x] = Math.max(r, g, b) - Math.min(r, g, b);
}

// Outline traced by eye from the photo (original 1223x1094 pixel coordinates), mapped into the crop.
const CROP = PD ? { x: 140, y: 80, k: 920 / W } : { x: 300, y: 125, k: 880 / W };
const toSmall = ([x, y]) => [(x - CROP.x) / CROP.k, (y - CROP.y) / CROP.k];
// public-domain photo: traced on a 0.5239 preview, so divide by it for original pixels
const pv = (pts) => pts.map(([x, y]) => [x / 0.5239, y / 0.5239]);
const PD_BIRD = pv([[538, 97], [520, 88], [500, 82], [490, 70], [480, 62], [455, 55], [430, 62], [415, 75], [410, 95], [412, 112], [420, 130], [400, 145], [370, 152], [340, 158], [310, 170], [270, 195], [220, 222], [170, 248], [130, 265], [100, 285], [90, 295], [115, 293], [180, 286], [220, 281], [250, 292], [275, 315], [300, 335], [330, 346], [362, 346], [390, 332], [420, 315], [450, 290], [470, 268], [485, 243], [492, 213], [493, 180], [495, 150], [497, 122], [502, 108], [518, 104]]);
const PD_LEGS = [[[340, 340], [356, 380], [378, 408]], [[366, 343], [377, 374], [396, 400]], [[378, 408], [362, 410]], [[378, 408], [388, 414]], [[396, 400], [384, 404]], [[396, 400], [408, 404]]].map(pv);
const BIRD = PD ? PD_BIRD.map(toSmall) : [[575, 142], [628, 150], [655, 185], [662, 240], [662, 300], [700, 345], [760, 410], [820, 470], [880, 560], [960, 650], [1050, 740], [1110, 830], [1112, 870], [1095, 880], [1150, 1000], [1150, 1025], [1085, 1028], [1000, 960], [930, 920], [860, 860], [810, 820], [760, 830], [700, 828], [640, 800], [560, 790], [480, 760], [420, 690], [385, 600], [368, 500], [368, 420], [395, 370], [440, 320], [455, 255], [480, 190], [520, 155]].map(toSmall);
const RAIL = PD ? [] : [[0, 802], [400, 870], [800, 960], [1160, 1046], [1160, 1094], [1060, 1094], [700, 1010], [300, 935], [0, 900]].map(toSmall);
const LEGS = PD ? PD_LEGS.map((l) => l.map(toSmall)) : [[[610, 770], [575, 900], [545, 980]], [[738, 815], [720, 900], [690, 1010]], [[545, 935], [470, 960]], [[545, 935], [610, 960]], [[700, 975], [600, 990]], [[700, 975], [740, 990]]].map((l) => l.map(toSmall));
const inPoly = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const nearSeg = (x, y, [ax, ay], [bx, by], r) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= r;
};
if (process.env.TRACE !== '0') {
  var traced = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = inPoly(BIRD, x, y) || inPoly(RAIL, x, y);
    if (!v) for (const leg of LEGS) for (let s = 0; s + 1 < leg.length; s++) if (nearSeg(x, y, leg[s], leg[s + 1], 4.5)) v = true;
    traced[y * W + x] = v ? 1 : 0;
  }
}

// The crow and the railing are near-neutral; the background is green and yellow.
let mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = sat[i] < Number(process.env.SAT ?? 30) && lum[i] < Number(process.env.LUM ?? 215) ? 1 : 0;
const morph = (m, grow) => {
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx, s = yy < 0 || yy >= H || xx < 0 || xx >= W ? 0 : m[yy * W + xx];
      v = grow ? v | s : v & s;
    }
    o[y * W + x] = v;
  }
  return o;
};
for (let k = 0; k < 2; k++) mask = morph(mask, false);
for (let k = 0; k < 4; k++) mask = morph(mask, true);
for (let k = 0; k < 2; k++) mask = morph(mask, false);
// keep the largest connected region (the bird on its rail)
const lab = new Int32Array(W * H), sizes = [0];
for (let i = 0; i < W * H; i++) if (mask[i] && !lab[i]) {
  const id = sizes.length, stack = [i]; lab[i] = id; let n = 0;
  while (stack.length) {
    const j = stack.pop(); n++;
    const x = j % W, y = (j / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy, k = yy * W + xx;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H && mask[k] && !lab[k]) { lab[k] = id; stack.push(k); }
    }
  }
  sizes.push(n);
}
const big = sizes.indexOf(Math.max(...sizes));
for (let i = 0; i < W * H; i++) mask[i] = lab[i] === big ? 1 : 0;
// fill holes: anything not reachable from the border outside the mask is inside
const out = new Uint8Array(W * H), st = [];
for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
while (st.length) {
  const j = st.pop();
  if (out[j] || mask[j]) continue;
  out[j] = 1;
  const x = j % W, y = (j / W) | 0;
  if (x > 0) st.push(j - 1); if (x < W - 1) st.push(j + 1); if (y > 0) st.push(j - W); if (y < H - 1) st.push(j + W);
}
for (let i = 0; i < W * H; i++) mask[i] = out[i] ? 0 : 1;
if (traced) mask = traced;

// debug view: the photo's luminance where masked, white elsewhere
const dbg = Buffer.alloc(54 + W * H * 3 + H * ((4 - ((W * 3) % 4)) % 4));
const pad = (4 - ((W * 3) % 4)) % 4;
dbg.write('BM'); dbg.writeUInt32LE(dbg.length, 2); dbg.writeUInt32LE(54, 10); dbg.writeUInt32LE(40, 14);
dbg.writeInt32LE(W, 18); dbg.writeInt32LE(H, 22); dbg.writeUInt16LE(1, 26); dbg.writeUInt16LE(24, 28);
let p = 54;
for (let y = H - 1; y >= 0; y--) { for (let x = 0; x < W; x++) { const v = mask[y * W + x] ? lum[y * W + x] : 255; dbg[p++] = v; dbg[p++] = v; dbg[p++] = v; } p += pad; }
writeFileSync(here('mask.bmp'), dbg);

// --- engraving: parallel cuts whose width follows the darkness ---
// Seal coordinates: the crow fills a box centred in the field circle (centre 60,61, radius ~40).
const S = Number(process.env.SCALE ?? 0.255), OX = 60 - (W * S) / 2 + Number(process.env.DX ?? 2), OY = 61 - (H * S) / 2 + Number(process.env.DY ?? 1);
const sample = (sx, sy) => {
  const x = (sx - OX) / S, y = (sy - OY) / S;
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) return null;
  if (!mask[yi * W + xi]) return null;
  // light smoothing
  let s = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += lum[(yi + dy) * W + xi + dx];
  return s / 9;
};
const GAP = Number(process.env.GAP ?? 1.25); // distance between cuts, in seal units
const ANG = (Number(process.env.ANG ?? -28) * Math.PI) / 180;
const ux = Math.cos(ANG), uy = Math.sin(ANG), nx = -uy, ny = ux;
const polys = [];
const R = 46;
for (let k = -R; k <= R; k += GAP) {
  const cx = 60 + nx * k, cy = 61 + ny * k;
  let up = [], dn = [];
  const flush = () => { if (up.length > 1) polys.push(up.concat(dn.reverse())); up = []; dn = []; };
  for (let t = -R; t <= R; t += 0.35) {
    const x = cx + ux * t, y = cy + uy * t;
    // a gentle wave, as a hand-guided graver wanders
    const wv = 0.18 * Math.sin(t * 0.55 + k * 1.3);
    const L = sample(x, y);
    if (L === null) { flush(); continue; }
    // tonal curve: the grey mantle to fine cuts, the black hood, wing and tail to solid
    const LO = Number(process.env.LO ?? 70), HI = Number(process.env.HI ?? 200);
    const dark = Math.pow(Math.min(1, Math.max(0, (HI - L) / (HI - LO))), Number(process.env.GAMMA ?? 1.6));
    const w = Math.min(GAP * 1.04, GAP * 1.15 * dark);
    if (w < 0.1) { flush(); continue; }
    up.push([x + nx * (wv + w / 2), y + ny * (wv + w / 2)]);
    dn.push([x + nx * (wv - w / 2), y + ny * (wv - w / 2)]);
  }
  flush();
}
const f = (n) => n.toFixed(2).replace(/\.?0+$/, '');
const d = polys.map((pl) => 'M' + pl.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z').join('');
writeFileSync(here('cuts.txt'), d);

// the field's horizontal cuts, stopping short of the bird (a cleared margin around it)
const near = (sx, sy, r) => {
  for (let a = 0; a < 8; a++) { const q = sample(sx + r * Math.cos(a * Math.PI / 4), sy + r * Math.sin(a * Math.PI / 4)); if (q !== null) return true; }
  return sample(sx, sy) !== null;
};
let hatch = '';
for (let y = 22; y <= 100; y += 3.2) {
  const half = Math.sqrt(Math.max(0, 40.5 * 40.5 - (y - 60) ** 2));
  let on = null;
  for (let x = 60 - half; x <= 60 + half + 0.4; x += 0.4) {
    const free = x <= 60 + half && !near(x, y, 2.2);
    if (free && on === null) on = x;
    if (!free && on !== null) { if (x - on > 0.8) hatch += `M${f(on)} ${f(y)}H${f(x - 0.4)}`; on = null; }
  }
}
const toSeal = ([x, y]) => [OX + x * S, OY + y * S];
const groundY = Math.max(...LEGS.flat().map(([, y]) => OY + y * S)) - 0.3;
const ground = PD ? `<path d="M10 ${f(groundY)} C40 ${f(groundY - 1)} 80 ${f(groundY - 1)} 110 ${f(groundY + 0.5)} V112 H10 Z" fill="#1d1d1f"/><path d="M28 ${f(groundY + 3.5)} H52 M62 ${f(groundY + 3.5)} H90 M36 ${f(groundY + 7)} H82" stroke="#fff" stroke-width="0.8"/>` : '';
const outline = [BIRD, RAIL].filter((pl) => pl.length).map((pl) => 'M' + pl.map(toSeal).map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z').join('');
const legend = process.env.LEGEND ?? '· ’CROW · VERIFIABLY NEUTRAL ESCROW ·';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-labelledby="t">
  <title id="t">’crow: a hooded crow engraved in the manner of a woodblock seal</title>
  <defs>
    <!-- an ink stamp's impression: wavering edges, ink that bleeds and pools, worn specks, uneven pressure -->
    <filter id="stamp" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="0.25" result="b"/>
      <feComponentTransfer in="b" result="ink"><feFuncA type="linear" slope="4" intercept="-1.3"/></feComponentTransfer>
      <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="1" seed="4" result="s"/>
      <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 11" result="specks"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="21" result="mt"/>
      <feColorMatrix in="mt" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.1 0.5" result="pressure"/>
      <feComposite in="ink" in2="specks" operator="in" result="a"/>
      <feComposite in="a" in2="pressure" operator="in"/>
    </filter>
    <clipPath id="field"><circle cx="60" cy="60" r="41"/></clipPath>
    <path id="legend" d="M60 104.8 a44.8 44.8 0 1 1 0 -89.6 a44.8 44.8 0 1 1 0 89.6"/>
  </defs>
  <g filter="url(#stamp)">
    <circle cx="60" cy="60" r="58" fill="#fff"/>
    <circle cx="60" cy="60" r="56" fill="none" stroke="#1d1d1f" stroke-width="3"/>
    <circle cx="60" cy="60" r="52.8" fill="none" stroke="#1d1d1f" stroke-width="0.8"/>
    <circle cx="60" cy="60" r="42" fill="none" stroke="#1d1d1f" stroke-width="1.6"/>
    <text font-family="'Times New Roman', Times, Georgia, serif" font-size="7.4" font-weight="700" letter-spacing="1.25" fill="#1d1d1f">
      <textPath href="#legend" startOffset="50%" text-anchor="middle">${legend}</textPath>
    </text>
    <g clip-path="url(#field)">
      <path d="${hatch}" stroke="#1d1d1f" stroke-width="0.5" fill="none"/>
      ${ground}
      <path d="${d}" fill="#1d1d1f"/>
      <path d="${outline}" fill="none" stroke="#1d1d1f" stroke-width="0.8" stroke-linejoin="round"/>
    </g>
  </g>
</svg>
`;
writeFileSync(here('seal.svg'), svg);
console.log(`image ${W}x${H}, ${polys.length} cuts, seal ${(svg.length / 1024).toFixed(1)} KB`);
