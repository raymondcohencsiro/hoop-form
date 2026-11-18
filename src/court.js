// Court surface: a clean maple base painted in the browser (boards, apron stain,
// anti-aliased paint areas) plus every FIBA line as true vector geometry, so
// arcs and circles stay crisp at any distance instead of following texels.
/* global BABYLON */
import * as C from './config.js';

const B = () => window.BABYLON;
const LINE_W = 0.05;
const KEY_W = 4.9, CIRCLE_R = 1.8, THREE_R = 6.75, THREE_CORNER = 0.9, NO_CHARGE_R = 1.25;
const KEY_RGB = [150, 40, 35];
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Painted floor texture covering W x L metres (court + apron). u = x, v = z (v = 1 at +z). */
export function paintCourt(scene, W, L) {
  const s = 96, cw = Math.round(W * s), ch = Math.round(L * s);
  const t = new (B().DynamicTexture)('courtPaint', { width: cw, height: ch }, scene, true);
  const ctx = t.getContext(), r = rng(3);
  const P = (x, z) => [(x + W / 2) * s, (L / 2 - z) * s];
  // maple boards along the court length, 36 per 2 m (lines up with the floor's detail map)
  ctx.fillStyle = 'rgb(214,168,112)'; ctx.fillRect(0, 0, cw, ch);
  const bw = (2 / 36) * s;
  for (let k = 0; k * bw < cw; k++) {
    const d = (r() - 0.5) * 20 + (r() - 0.5) * 8;
    ctx.fillStyle = `rgb(${214 + d},${168 + d * 0.85},${112 + d * 0.6})`;
    ctx.fillRect(k * bw, 0, bw + 0.6, ch);
  }
  for (let k = 0; k < 9000; k++) {                       // long grain streaks
    const x = r() * cw, y = r() * ch, len = 30 + r() * 260;
    ctx.globalAlpha = 0.04 + r() * 0.07;
    ctx.fillStyle = r() < 0.6 ? 'rgb(150,100,55)' : 'rgb(240,205,150)';
    ctx.fillRect(x, y, 0.8 + r() * 1.2, len);
  }
  ctx.globalAlpha = 1;
  // out-of-bounds apron: darker stain around the court
  const hx = C.COURT_WIDTH / 2, hz = C.COURT_LENGTH / 2;
  ctx.fillStyle = 'rgba(70,30,18,0.47)';
  ctx.beginPath(); ctx.rect(0, 0, cw, ch);
  const [ax, ay] = P(-hx, hz), [bx, by] = P(hx, -hz);
  ctx.rect(ax, ay, bx - ax, by - ay);
  ctx.fill('evenodd');
  // painted areas (edges sit under the vector lines)
  const key = `rgba(${KEY_RGB.join(',')},0.93)`;
  ctx.fillStyle = key;
  for (const sign of [1, -1]) {
    const bz = sign * hz, ftz = bz - sign * C.FT_LINE_FROM_BASELINE;
    const [x0, y0] = P(-KEY_W / 2, Math.max(bz, ftz)), [x1, y1] = P(KEY_W / 2, Math.min(bz, ftz));
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  const [cx, cy] = P(0, 0), circ = (rad, style) => { ctx.fillStyle = style; ctx.beginPath(); ctx.arc(cx, cy, rad * s, 0, Math.PI * 2); ctx.fill(); };
  circ(CIRCLE_R, key); circ(0.9, 'rgb(240,190,40)'); circ(0.675, `rgb(${KEY_RGB.join(',')})`);
  t.update();
  t.anisotropicFilteringLevel = 16;
  return t;
}

// ---------------------------------------------------------------- vector lines
const arc = (cx, cz, rad, a0, a1, step = 0.04) => {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * rad / step)), out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + rad * Math.cos(a), cz + rad * Math.sin(a)]); }
  return out;
};
/** Flat ribbon along a polyline (mitred joints); returns positions + indices appended to acc. */
function ribbon(acc, pts, closed = false, w = LINE_W, y = 0.0025) {
  const n = pts.length, hw = w / 2, base = acc.P.length / 3;
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const d0 = i === 0 && !closed ? dir(pts[0], pts[1]) : dir(prev, pts[i]);
    const d1 = i === n - 1 && !closed ? dir(pts[n - 2], pts[n - 1]) : dir(pts[i], next);
    let mx = -(d0[1] + d1[1]), mz = d0[0] + d1[0]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = hw / Math.max(0.3, mx * -d1[1] + mz * d1[0]);          // miter length
    acc.P.push(pts[i][0] + mx * k, y, pts[i][1] + mz * k, pts[i][0] - mx * k, y, pts[i][1] - mz * k);
    acc.N.push(0, 1, 0, 0, 1, 0);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = base + 2 * i, b = base + 2 * ((i + 1) % n);
    acc.I.push(a, b, a + 1, a + 1, b, b + 1);
  }
}
export function courtLines(scene) {
  const hx = C.COURT_WIDTH / 2, hz = C.COURT_LENGTH / 2, kx = KEY_W / 2, acc = { P: [], N: [], I: [] };
  ribbon(acc, [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]], true);                 // boundary
  ribbon(acc, [[-hx - 0.15, 0], [hx + 0.15, 0]]);                                     // centre line
  ribbon(acc, arc(0, 0, CIRCLE_R, 0, Math.PI * 2).slice(0, -1), true);                // centre circle
  for (const zz of [1, -1]) for (const xx of [1, -1]) ribbon(acc, [[xx * hx, zz * (hz - 8.325)], [xx * (hx + 0.15), zz * (hz - 8.325)]]);  // throw-in marks
  for (const sign of [1, -1]) {
    const bz = sign * hz, ftz = bz - sign * C.FT_LINE_FROM_BASELINE, bkz = bz - sign * C.BASKET_FROM_BASELINE;
    ribbon(acc, [[-kx, bz], [-kx, ftz], [kx, ftz], [kx, bz]]);                        // key
    const out0 = sign > 0 ? Math.PI : 0;                                              // free-throw circle
    ribbon(acc, arc(0, ftz, CIRCLE_R, out0, out0 + Math.PI));                         //   solid half (outside the key)
    const in0 = out0 + Math.PI;
    for (let k = 0; k < 8; k++) {                                                     //   dashed half (inside)
      const a0 = in0 + (10 + k * 21) * Math.PI / 180;
      ribbon(acc, arc(0, ftz, CIRCLE_R, a0, a0 + 10 * Math.PI / 180, 0.02));
    }
    const cx = hx - THREE_CORNER, dz = Math.sqrt(THREE_R ** 2 - cx ** 2), zc = bkz - sign * dz;
    const aR = Math.atan2(zc - bkz, cx), aL = Math.atan2(zc - bkz, -cx);
    const three = [[cx, bz], [cx, zc], ...arc(0, bkz, THREE_R, aR, sign > 0 ? (aL > aR ? aL - 2 * Math.PI : aL) : (aL < aR ? aL + 2 * Math.PI : aL)).slice(1, -1), [-cx, zc], [-cx, bz]];
    ribbon(acc, three);
    const nA = 0, nB = sign > 0 ? -Math.PI : Math.PI;                  // no-charge semicircle
    ribbon(acc, [[NO_CHARGE_R, bkz + sign * 0.375], ...arc(0, bkz, NO_CHARGE_R, nA, nB), [-NO_CHARGE_R, bkz + sign * 0.375]]);
    for (const dist of [1.75, 2.6, 3.45, 4.3]) {                                      // lane-space marks
      const mz = bz - sign * dist;
      for (const xs of [1, -1]) ribbon(acc, [[xs * kx, mz], [xs * (kx + 0.1), mz]]);
    }
  }
  // consistent winding: every triangle faces up
  for (let i = 0; i < acc.I.length; i += 3) {
    const [a, b, c] = [acc.I[i], acc.I[i + 1], acc.I[i + 2]].map((k) => [acc.P[3 * k], acc.P[3 * k + 2]]);
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr < 0) { const t = acc.I[i + 1]; acc.I[i + 1] = acc.I[i + 2]; acc.I[i + 2] = t; }
  }
  const BABYLON = B(), m = new BABYLON.Mesh('courtlines', scene), vd = new BABYLON.VertexData();
  vd.positions = acc.P; vd.normals = acc.N; vd.indices = acc.I; vd.applyToMesh(m);
  const mat = new BABYLON.StandardMaterial('courtlinesm', scene);
  mat.diffuseColor = new BABYLON.Color3(0.96, 0.96, 0.95);
  mat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4); mat.specularPower = 90;
  mat.zOffset = -2; mat.backFaceCulling = false;
  m.material = mat; m.isPickable = false;
  return m;
}
