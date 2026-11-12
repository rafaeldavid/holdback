// Six small pencil studies for the landing page's value props, drawn to sit beside Thorburn's 1919 crow: period
// objects in fine graphite line. Lines carry weight the way a draughtsman's do: light on the side the light falls,
// heavier in shadow, and tone is built from fine parallel strokes that swell where the form turns away. Light comes
// from the upper left. Each study is a 64 × 64 drawing in one colour; a seeded generator places every stroke, so
// each build draws the same lines. site/build.mjs sets them into the page.
const INK = '#33312e';
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const n = (v) => +v.toFixed(1);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const WIDTHS = [0.22, 0.34, 0.5, 0.7, 0.95]; // the pencil's five weights
const SHADE = [0.55, 0.83]; // the direction away from the light

// --- geometry: every shape is a list of points ---
const ell = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, rot = 0) => {
  const steps = Math.max(8, Math.ceil((Math.abs(a1 - a0) * Math.max(rx, ry)) / 1.1)), c = Math.cos(rot), s = Math.sin(rot), pts = [];
  for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps, x = rx * Math.cos(a), y = ry * Math.sin(a); pts.push([cx + x * c - y * s, cy + x * s + y * c]); }
  return pts;
};
const bez = (p0, p1, p2, p3, steps = 18) => Array.from({ length: steps + 1 }, (_, i) => { const t = i / steps, m = 1 - t; return [0, 1].map((k) => m * m * m * p0[k] + 3 * m * m * t * p1[k] + 3 * m * t * t * p2[k] + t * t * t * p3[k]); });
const quad = (p0, p1, p2, steps = 12) => Array.from({ length: steps + 1 }, (_, i) => { const t = i / steps, m = 1 - t; return [0, 1].map((k) => m * m * p0[k] + 2 * m * t * p1[k] + t * t * p2[k]); });
const seg = (a, b) => { const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.3)); return Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]); };
const join = (...parts) => parts.flatMap((p, i) => (i ? p.slice(1) : p));
const scaled = (pts, [cx, cy], k) => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
const dOf = (pts, close = true) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + (close ? 'Z' : '');

// --- the pencil ---
/** Segments grouped by weight: one path per weight, so a study stays small. */
const nearest = (w) => { let k = 0; for (let i = 1; i < WIDTHS.length; i++) if (Math.abs(WIDTHS[i] - w) < Math.abs(WIDTHS[k] - w)) k = i; return k; };
function weights() {
  const runs = WIDTHS.map(() => []);
  return {
    add(a, b, w) { const k = nearest(w), last = runs[k][runs[k].length - 1]; if (last && last[last.length - 1] === a) last.push(b); else runs[k].push([a, b]); },
    svg(o = 0.78) { return runs.map((rs, k) => (rs.length ? `<path d="${rs.map((p) => dOf(p, false)).join('')}" stroke-width="${WIDTHS[k]}" opacity="${o}"/>` : '')).join(''); },
  };
}
/**
 * A contour. With a centre, the line is light where the form faces the light and heavy where it turns away, and it
 * breaks here and there on the lit side, as a pencil lifts. Without one, it keeps one weight.
 */
function contour(r, pts, { c, w = [0.24, 0.9], lost = 0.1, o = 0.8 } = {}) {
  const out = weights();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let f = 0.5;
    if (c) { const vx = (a[0] + b[0]) / 2 - c[0], vy = (a[1] + b[1]) / 2 - c[1], l = Math.hypot(vx, vy) || 1; f = clamp(((vx * SHADE[0] + vy * SHADE[1]) / l) * 0.75 + 0.3); }
    if (c && f < 0.12 && r() < lost) continue;
    out.add(a, b, w[0] + (w[1] - w[0]) * f * (0.85 + 0.3 * r()));
  }
  return out.svg(o);
}
/** Tone: fine parallel strokes across a box, each as heavy as the tone under it and absent where the paper shows. */
function tone(r, [x0, y0, x1, y1], angle, gap, f, { w = [0.2, 0.62], o = 0.62 } = {}) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 1;
  const a = (angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, out = weights();
  for (let s = -R; s <= R; s += gap * (0.82 + r() * 0.36)) {
    let a = null, b = null, k = -1; // the stroke so far: from a to b in weight k. A straight run in one weight is one segment
    const end = () => { if (a && b) out.add(a, b, WIDTHS[k]); a = b = null; };
    const lift = r() * 0.25; // each stroke starts and stops a little differently
    for (let t = -R; t <= R + 1.2; t += 1.2) {
      const p = [cx + nx * s + dx * t + (r() - 0.5) * 0.12, cy + ny * s + dy * t + (r() - 0.5) * 0.12];
      const v = p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 ? f(p[0], p[1]) * (0.8 + 0.4 * r()) - lift * 0.3 : 0;
      if (v <= 0.1) { end(); continue; }
      const kk = nearest(w[0] + (w[1] - w[0]) * clamp(v));
      if (!a) { a = p; k = kk; } else if (kk === k) b = p; else { if (b) out.add(a, b, WIDTHS[k]); a = b ?? a; b = p; k = kk; }
    }
    end();
  }
  return out.svg(o);
}
const clip = (id, d) => `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath>`;
const within = (id, body) => `<g clip-path="url(#${id})">${body}</g>`;
const solid = (pts, o = 0.78) => `<path d="${dOf(pts)}" fill="${INK}" stroke="none" opacity="${o}"/>`;
/** The shadow an object casts on the paper: a few faint strokes under it, to the right. */
const cast = (r, x0, x1, y) => tone(r, [x0, y, x1, y + 2.6], -4, 0.85, (x) => 0.42 * Math.sin((Math.PI * (x - x0)) / (x1 - x0)), { w: [0.2, 0.4], o: 0.42 });
/** How far a point lies toward the shadow side of a box, 0 to 1. */
const toward = (x0, y0, x1, y1) => (x, y) => clamp((((x - x0) / (x1 - x0)) * SHADE[0] + ((y - y0) / (y1 - y0)) * SHADE[1]) / (SHADE[0] + SHADE[1]));

// 1. Verifiable Settlement: a padlock. The payment is held until the work passes.
function padlock() {
  const r = rng(11), C = [32, 41];
  const body = join(quad([17.4, 31], [17.4, 28.8], [20, 28.8]), seg([20, 28.8], [44, 28.8]), quad([44, 28.8], [46.6, 28.8], [46.6, 31]), seg([46.6, 31], [46.6, 41.5]), bez([46.6, 41.5], [46.6, 49.5], [40, 54.6], [32, 57.4]), bez([32, 57.4], [24, 54.6], [17.4, 49.5], [17.4, 41.5]), seg([17.4, 41.5], [17.4, 31]));
  const rim = scaled(body, [32, 41.6], 0.83);
  const outer = join(seg([21.6, 28.8], [21.6, 19.6]), ell(32, 19.6, 10.4, 10.4, Math.PI, Math.PI * 2), seg([42.4, 19.6], [42.4, 28.8]));
  const inner = join(seg([25.8, 28.8], [25.8, 19.8]), ell(32, 19.8, 6.2, 6.2, Math.PI, Math.PI * 2), seg([38.2, 19.8], [38.2, 28.8]));
  const shackle = dOf(outer, false) + dOf(inner.slice().reverse(), false).replace('M', 'L') + 'Z';
  const hole = join(ell(32, 39.4, 2.3, 2.3, Math.PI * 0.62, Math.PI * 2.38), seg([33.4, 41.2], [34, 47.4]), seg([34, 47.4], [30, 47.4]), seg([30, 47.4], [30.6, 41.2]));
  const dark = toward(17, 29, 47, 57);
  return (
    `<defs>${clip('pl-body', dOf(body))}${clip('pl-shackle', shackle)}</defs>` +
    within('pl-body', tone(r, [17, 28, 47, 58], -62, 1.05, (x, y) => 0.08 + 0.92 * Math.pow(dark(x, y), 1.5)) + tone(r, [28, 44, 47, 58], 24, 1.3, (x, y) => 0.75 * Math.pow(dark(x, y), 3))) +
    within('pl-shackle', tone(r, [21, 9, 43, 29], -62, 0.95, (x, y) => (x > 32 ? 0.25 + 0.6 * clamp((x - 32) / 10) : 0) + (y > 25 ? 0.5 : 0))) +
    contour(r, body, { c: C }) + contour(r, rim, { c: C, w: [0.2, 0.5], lost: 0.25, o: 0.6 }) +
    contour(r, outer, { c: [32, 20], w: [0.26, 0.85] }) + contour(r, inner, { c: [32, 30], w: [0.22, 0.6], o: 0.7 }) +
    contour(r, ell(32, 42.6, 5.4, 7.4), { c: [32, 42.6], w: [0.2, 0.5], o: 0.65 }) + solid(hole, 0.8) +
    [[21.4, 32.6], [42.6, 32.6]].map(([x, y]) => contour(r, ell(x, y, 0.9, 0.9), { c: [x, y], w: [0.2, 0.6] })).join('') +
    cast(r, 27, 56, 58.6)
  );
}

// 2. Made for Machines: a clock's wheel and its pinion.
function wheel() {
  const r = rng(23), C = [28.5, 35.5], P = [48.6, 15.4], N = 44;
  const teeth = Array.from({ length: N * 2 + 1 }, (_, i) => { const a = (i * Math.PI) / N, rad = i % 2 ? 22 : 19.9; return [C[0] + rad * Math.cos(a), C[1] + rad * Math.sin(a)]; });
  const leaves = Array.from({ length: 8 * 4 + 1 }, (_, i) => { const a = 0.32 + (i * Math.PI * 2) / 32, rad = [4, 6.3, 6.3, 4][i % 4]; return [P[0] + rad * Math.cos(a), P[1] + rad * Math.sin(a)]; });
  const rimIn = ell(C[0], C[1], 16.3, 16.3), hub = ell(C[0], C[1], 3.7, 3.7);
  const spokes = Array.from({ length: 5 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; return [-1, 1].map((sd) => seg([C[0] + 3.6 * Math.cos(a + sd * 0.42), C[1] + 3.6 * Math.sin(a + sd * 0.42)], [C[0] + 16.3 * Math.cos(a + sd * 0.052), C[1] + 16.3 * Math.sin(a + sd * 0.052)])); }).flat();
  const away = (c) => (x, y) => { const vx = x - c[0], vy = y - c[1], l = Math.hypot(vx, vy) || 1; return clamp(((vx * SHADE[0] + vy * SHADE[1]) / l) * 0.7 + 0.32); };
  return (
    `<defs>${clip('wh-rim', dOf(teeth) + dOf(rimIn))}${clip('wh-hub', dOf(hub))}${clip('wh-pin', dOf(leaves))}</defs>` +
    within('wh-rim', tone(r, [6, 13, 51, 58], -62, 0.95, (x, y) => Math.pow(away(C)(x, y), 1.7))) +
    within('wh-hub', tone(r, [24, 31, 33, 40], -62, 0.8, (x, y) => 0.25 + 0.6 * away(C)(x, y))) +
    within('wh-pin', tone(r, [41, 8, 56, 23], -62, 0.85, (x, y) => 0.12 + 0.75 * Math.pow(away(P)(x, y), 1.4))) +
    contour(r, teeth, { c: C, w: [0.24, 0.72], lost: 0 }) + contour(r, rimIn, { c: [C[0] + 9, C[1] + 12], w: [0.22, 0.6], lost: 0, o: 0.7 }) +
    spokes.map((s) => contour(r, s, { w: [0.3, 0.3], o: 0.7 })).join('') +
    contour(r, hub, { c: C, w: [0.26, 0.8] }) + solid(ell(C[0], C[1], 1.15, 1.15), 0.8) +
    contour(r, leaves, { c: P, w: [0.24, 0.75], lost: 0 }) + contour(r, ell(P[0], P[1], 2.3, 2.3), { c: P, w: [0.2, 0.55] }) + solid(ell(P[0], P[1], 0.8, 0.8), 0.8) +
    cast(r, 22, 56, 59.4)
  );
}

// 3. High Speed, Low Cost: a flight feather. Its barbs are the tone.
function feather() {
  const r = rng(37), P = [[11.5, 56.5], [21, 44], [35, 27], [52, 8]], T0 = 0.19;
  const at = (t) => { const m = 1 - t; return [0, 1].map((k) => m * m * m * P[0][k] + 3 * m * m * t * P[1][k] + 3 * m * t * t * P[2][k] + t * t * t * P[3][k]); };
  const tan = (t) => { const m = 1 - t, v = [0, 1].map((k) => 3 * m * m * (P[1][k] - P[0][k]) + 6 * m * t * (P[2][k] - P[1][k]) + 3 * t * t * (P[3][k] - P[2][k])), l = Math.hypot(...v); return [v[0] / l, v[1] / l]; };
  const shape = (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6);
  // the vane's width each side of the shaft; the trailing side is wider and has parted once
  const width = (u, side) => (side < 0 ? 5.6 : 9.8) * shape(u) * (side > 0 && u > 0.47 && u < 0.53 ? 0.5 + Math.abs(u - 0.5) * 16 : 1);
  const edge = (side) => Array.from({ length: 41 }, (_, i) => { const u = i / 40, t = T0 + u * (1 - T0), [x, y] = at(t), [tx, ty] = tan(t), w = width(u, side); return [x - ty * w * side, y + tx * w * side]; });
  const L = edge(-1), Rt = edge(1), fine = weights(), deep = weights();
  for (const side of [-1, 1]) {
    for (let u = 0.02; u < 0.99; u += 0.013 + r() * 0.007) {
      const t = T0 + u * (1 - T0), [x, y] = at(t), [tx, ty] = tan(t), w = width(u, side) * 1.3 + 0.5, lean = 0.7 + r() * 0.16, ox = -ty * side, oy = tx * side;
      const barb = quad([x, y], [x + (ox * 0.6 + tx * lean * 0.15) * w, y + (oy * 0.6 + ty * lean * 0.15) * w], [x + (ox + tx * lean) * w, y + (oy + ty * lean) * w], 6);
      for (let i = 1; i < barb.length; i++) fine.add(barb[i - 1], barb[i], side > 0 ? 0.3 - i * 0.012 : 0.24);
      if (side > 0 && r() < 0.85) { const k = 2 + Math.floor(r() * 3); for (let i = 1; i <= k; i++) deep.add(barb[i - 1], barb[i], 0.5 - i * 0.06); }
    }
  }
  const shaft = weights(), line = Array.from({ length: 41 }, (_, i) => at(i / 40));
  for (let i = 1; i < line.length; i++) shaft.add(line[i - 1], line[i], 1.05 - (i / 40) * 0.8);
  return (
    `<defs>${clip('ft-vane', dOf(join(L, Rt.slice().reverse())))}</defs>` +
    within('ft-vane', fine.svg(0.6) + deep.svg(0.55)) +
    contour(r, L, { w: [0.24, 0.24], o: 0.5 }) + contour(r, Rt, { c: [20, 20], w: [0.22, 0.5], lost: 0.2, o: 0.6 }) + shaft.svg(0.82) +
    cast(r, 12, 44, 59.4)
  );
}

// 4. Frontier AI Verification: a balance, level.
function balance() {
  const r = rng(41);
  const half = (y) => { const T = [[15, 0.6], [20, 0.75], [27, 0.95], [38, 1.75], [43, 1.9], [46.5, 1.05], [48, 1.35], [50, 2.5]]; for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const k = (y - T[i - 1][0]) / (T[i][0] - T[i - 1][0]); return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * k; } return 2.5; };
  const col = (sd) => Array.from({ length: 36 }, (_, i) => { const y = 15 + i; return [32 + sd * half(y), y]; });
  const foot = join(seg([28, 50], [36, 50]), quad([36, 50], [37.2, 53.2], [42.4, 54.4]), seg([42.4, 54.4], [44, 57]), seg([44, 57], [20, 57]), seg([20, 57], [21.6, 54.4]), quad([21.6, 54.4], [26.8, 53.2], [28, 50]));
  const top = join(quad([8.6, 22.2], [20, 16.4], [32, 17]), quad([32, 17], [44, 16.4], [55.4, 22.2])), under = join(quad([8.6, 22.6], [20, 20.6], [32, 20.9]), quad([32, 20.9], [44, 20.6], [55.4, 22.6]));
  const pan = (x) => ({ rim: ell(x, 40.2, 6.9, 1.45), bowl: quad([x - 6.9, 40.2], [x, 48], [x + 6.9, 40.2], 16) });
  const A = pan(9), B = pan(55);
  const chains = [[9, A], [55, B]].map(([x]) => [-6.4, 0, 6.4].map((dx) => `M${x} 22.6L${x + dx} ${dx ? 40 : 41.5}`).join('')).join('');
  return (
    `<defs>${clip('bl-col', dOf(join(col(-1), col(1).slice().reverse())))}${clip('bl-foot', dOf(foot))}${clip('bl-a', dOf(join(A.bowl, A.rim.slice(0, Math.ceil(A.rim.length / 2)).reverse())))}${clip('bl-b', dOf(join(B.bowl, B.rim.slice(0, Math.ceil(B.rim.length / 2)).reverse())))}${clip('bl-beam', dOf(join(top, under.slice().reverse())))}</defs>` +
    within('bl-col', tone(r, [29, 15, 35, 51], 0, 0.9, (x) => 0.1 + 0.85 * clamp((x - 31.4) / 2.4))) +
    within('bl-foot', tone(r, [20, 50, 44, 57.2], -62, 0.9, (x) => 0.12 + 0.8 * clamp((x - 26) / 18))) +
    within('bl-a', tone(r, [2, 40, 16, 48], -62, 0.8, (x, y) => 0.15 + 0.8 * clamp((x - 5) / 10) * clamp((y - 39.6) / 4 + 0.4))) +
    within('bl-b', tone(r, [48, 40, 62, 48], -62, 0.8, (x, y) => 0.15 + 0.8 * clamp((x - 51) / 10) * clamp((y - 39.6) / 4 + 0.4))) +
    within('bl-beam', tone(r, [8, 16, 56, 23], 90, 0.9, (x, y) => 0.25 + 0.5 * clamp((y - 18) / 3))) +
    contour(r, col(-1), { w: [0.26, 0.26], o: 0.7 }) + contour(r, col(1), { w: [0.6, 0.6] }) +
    contour(r, foot, { c: [30, 50], w: [0.24, 0.85], lost: 0 }) + contour(r, seg([21.6, 54.4], [42.4, 54.4]), { w: [0.3, 0.3], o: 0.6 }) +
    contour(r, top, { w: [0.34, 0.34] }) + contour(r, under, { w: [0.7, 0.7] }) +
    contour(r, ell(32, 13, 1.9, 1.9), { c: [32, 13], w: [0.24, 0.7], lost: 0 }) + solid(ell(32, 18.9, 0.85, 0.85), 0.75) +
    `<path d="${chains}" stroke-width="0.32" stroke-dasharray="0.7 0.85" opacity="0.75"/>` +
    [A, B].map((p, i) => contour(r, p.rim, { c: [i ? 55 : 9, 38.6], w: [0.24, 0.6], lost: 0 }) + contour(r, p.bowl, { c: [i ? 53 : 7, 38], w: [0.3, 0.9], lost: 0 })).join('') +
    cast(r, 24, 58, 58.4)
  );
}

// 5. Your Existing Rails: coin, the oldest rail. A stack, and one coin leaning on it.
function coins() {
  const r = rng(53), RX = 12.6, RY = 3.9, H = 3.1, base = 55, xs = [24.6, 25.4, 24.2, 25.2, 24.8];
  let out = '', defs = '';
  xs.forEach((x, k) => {
    const y = base - H * k, low = ell(x, y, RX, RY, 0, Math.PI), topFront = ell(x, y - H, RX, RY, 0, Math.PI);
    const side = join(seg([x + RX, y - H], [x + RX, y]), low, seg([x - RX, y], [x - RX, y - H]), topFront.slice().reverse());
    defs += clip(`cn-${k}`, dOf(side));
    // the milled edge: fine upright strokes, heavier toward the shadow
    out += within(`cn-${k}`, tone(r, [x - RX, y - H - 4, x + RX, y + RY], 90, 0.95, (px) => 0.16 + 0.8 * Math.pow(clamp((px - x + RX * 0.6) / (RX * 1.6)), 1.6), { w: [0.2, 0.55], o: 0.65 }));
    out += contour(r, low, { c: [x - 6, y - 8], w: [0.28, 0.85], lost: 0 }) + contour(r, seg([x - RX, y - H], [x - RX, y]), { w: [0.26, 0.26], o: 0.7 }) + contour(r, seg([x + RX, y - H], [x + RX, y]), { w: [0.7, 0.7] });
    if (k === xs.length - 1) out += contour(r, ell(x, y - H, RX, RY), { c: [x - 6, y - H - 6], w: [0.26, 0.7], lost: 0 }) + contour(r, ell(x, y - H, RX * 0.78, RY * 0.76), { c: [x + 8, y - H + 6], w: [0.2, 0.42], lost: 0.2, o: 0.6 });
    else out += contour(r, topFront, { w: [0.3, 0.3], o: 0.6 });
  });
  // the leaning coin, face on: its rim, a beaded ring and a laurel sprig
  const c = [47.6, 43.4], rot = -0.2, face = ell(c[0], c[1], 9.4, 10.6, 0, Math.PI * 2, rot), back = ell(c[0] + 1.7, c[1] + 0.5, 9.4, 10.6, -1.25, 1.75, rot);
  const sprig = quad([43.4, 49], [46.4, 43.6], [51.4, 37.6], 10);
  defs += clip('cn-face', dOf(face));
  out += contour(r, back, { w: [0.62, 0.62] }) +
    `<path d="${dOf(face)}" fill="#faf7f0" stroke="none"/>` +
    within('cn-face', tone(r, [38, 32, 58, 55], -62, 0.95, (x, y) => 0.75 * Math.pow(clamp(((x - 44) * 0.55 + (y - 40) * 0.83) / 12), 1.5))) +
    contour(r, face, { c, w: [0.26, 0.8], lost: 0 }) +
    `<path d="${dOf(ell(c[0], c[1], 7.3, 8.3, 0, Math.PI * 2, rot))}" stroke-width="0.34" stroke-dasharray="0.5 0.9" opacity="0.7"/>` +
    contour(r, sprig, { w: [0.34, 0.34], o: 0.75 }) +
    [2, 4, 6, 8].map((i) => { const [x, y] = sprig[i]; return [-1, 1].map((sd) => contour(r, quad([x, y], [x + sd * 2.2 + 0.6, y - 1.4], [x + sd * 2.6 + 1.6, y - 3.2], 5), { w: [0.3, 0.3], o: 0.72 })).join(''); }).join('');
  return `<defs>${defs}</defs>${out}${cast(r, 16, 60, 58.8)}`;
}

// 6. Private Delivery: a letter under a wax seal.
function letter() {
  const r = rng(67), rotate = (pts) => pts.map(([x, y]) => { const a = -0.09, dx = x - 32, dy = y - 34; return [32 + dx * Math.cos(a) - dy * Math.sin(a), 34 + dx * Math.sin(a) + dy * Math.cos(a)]; });
  const sheet = rotate(join(seg([7, 17.5], [57, 17.5]), seg([57, 17.5], [57, 50.5]), seg([57, 50.5], [7, 50.5]), seg([7, 50.5], [7, 17.5])));
  const flap = rotate(join(seg([7, 17.5], [32, 38]), seg([32, 38], [57, 17.5]))), foldL = rotate(seg([7, 50.5], [26.2, 33.4])), foldR = rotate(seg([57, 50.5], [37.8, 33.4]));
  const S = rotate([[32, 38.6]])[0];
  const wax = Array.from({ length: 49 }, (_, i) => { const a = (i * Math.PI * 2) / 48, rad = 7.1 + 0.55 * Math.sin(a * 3 + 0.6) + 0.35 * Math.sin(a * 7 + 2) + (a > 1.1 && a < 1.9 ? 1.5 * Math.sin(((a - 1.1) / 0.8) * Math.PI) : 0); return [S[0] + rad * Math.cos(a), S[1] + rad * Math.sin(a)]; });
  const lit = (x, y) => clamp(Math.hypot(x - S[0] + 2.4, y - S[1] + 2.6) / 8.5);
  const under = rotate([[7, 17.5], [32, 38], [57, 17.5], [57, 21.6], [32, 42.4], [7, 21.6]]);
  return (
    `<defs>${clip('lt-wax', dOf(wax))}${clip('lt-sheet', dOf(sheet))}${clip('lt-under', dOf(under))}</defs>` +
    within('lt-sheet', within('lt-under', tone(r, [5, 14, 59, 46], -62, 1, () => 0.42, { w: [0.2, 0.42], o: 0.5 })) + tone(r, [5, 14, 59, 54], -62, 1.15, (x, y) => 0.6 * Math.pow(clamp(((x - 30) * 0.55 + (y - 36) * 0.83) / 26), 1.6), { w: [0.2, 0.45], o: 0.55 })) +
    contour(r, sheet, { c: [32, 34], w: [0.26, 0.85], lost: 0.06 }) + contour(r, flap, { w: [0.4, 0.4], o: 0.75 }) + contour(r, foldL, { w: [0.24, 0.24], o: 0.55 }) + contour(r, foldR, { w: [0.24, 0.24], o: 0.55 }) +
    `<path d="${dOf(wax)}" fill="#faf7f0" stroke="none"/>` +
    within('lt-wax', tone(r, [24, 30, 41, 48], -62, 0.62, (x, y) => 0.3 + 0.7 * lit(x, y), { w: [0.26, 0.7], o: 0.72 }) + tone(r, [24, 30, 41, 48], 28, 0.8, (x, y) => 0.9 * Math.pow(lit(x, y), 2.2), { w: [0.22, 0.55], o: 0.6 })) +
    contour(r, wax, { c: S, w: [0.3, 0.95], lost: 0 }) + contour(r, ell(S[0], S[1], 4.1, 4.1), { c: [S[0] + 3, S[1] + 4], w: [0.22, 0.5], lost: 0.15, o: 0.7 }) +
    cast(r, 18, 60, 55.4)
  );
}

/** The six studies, in the order of FEATURES in site/build.mjs. */
export const STUDIES = [
  ['padlock', padlock()], ['wheel', wheel()], ['feather', feather()], ['balance', balance()], ['coins', coins()], ['letter', letter()],
].map(([name, body]) => ({
  name,
  svg: `<svg class="study" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g filter="url(#pencil)" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`,
}));

/**
 * The pencil: one filter shared by every study. It softens each line a touch, moves it very slightly, as a steady
 * hand does, and breaks it up with fine grain, as graphite does on laid paper.
 */
export const PENCIL = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><filter id="pencil" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="hand"/>
<feDisplacementMap in="SourceGraphic" in2="hand" scale="0.7" xChannelSelector="R" yChannelSelector="G" result="drawn"/>
<feGaussianBlur in="drawn" stdDeviation="0.09" result="soft"/>
<feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="2" seed="3" result="tooth"/>
<feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.9 0 0 0 -0.12" result="grain"/>
<feComposite in="soft" in2="grain" operator="in"/>
</filter></defs></svg>`;
