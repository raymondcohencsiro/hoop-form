// Realistic avatar surface: one continuous skinned body (torso, arms, legs)
// plus skinned clothing (tank-top jersey, loose shorts, socks) and rigid
// detail parts (sculpted head, eyes, ears, hair, articulated hands, sneakers).
//
// Everything is generated procedurally in the avatar's bind pose (all joint
// rotations zero, arms hanging) and expressed in avatar-height units (H). The
// kinematic skeleton in avatar.js is unchanged, so poses, IK and every coaching
// metric are identical to before; only the mesh that follows it is new.
import { V3, Node } from './math.js';
import { JOINTS } from './avatar.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const gauss = (d, s) => Math.exp(-(d * d) / (2 * s * s));
const angDist = (a, b) => { const d = Math.abs(((a - b) % TAU + TAU) % TAU); return Math.min(d, TAU - d); };
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const sexp = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);   // superellipse helper

/** Piecewise-linear table lookup: rows [x, ...values]. */
function table(rows, x) {
  if (x <= rows[0][0]) return rows[0].slice(1);
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const a = rows[i - 1], b = rows[i], t = (x - a[0]) / (b[0] - a[0] || 1);
      return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t);
    }
  }
  return rows[rows.length - 1].slice(1);
}

// ------------------------------------------------------------------ mesh grid
/**
 * Generic swept surface: rings i = 0..nr-1, ns segments around (closed).
 * f.point(i, th) -> V3, f.center(i) -> V3 (for outward orientation),
 * f.weights(i) -> {joint: w} (skinned) , f.keep(iMid, thMid) -> bool (cut holes),
 * f.color(i, th) -> [r,g,b] (optional vertex colours).
 * Triangles are oriented so Babylon treats the outside as the front face.
 */
export function grid(nr, ns, f) {
  const P = [], N = [], U = [], I = [], O = [], Cc = [], W = [];
  for (let i = 0; i < nr; i++) {
    const c = f.center(i);
    let axis = i > 0 ? c.sub(f.center(i - 1)) : f.center(0).sub(f.center(1));
    axis = axis.len() > 1e-9 ? axis.norm() : new V3(0, 1, 0);
    const w = f.weights ? f.weights(i) : null;
    for (let s = 0; s <= ns; s++) {
      const th = TAU * s / ns, p = f.point(i, th);
      P.push(p.x, p.y, p.z);
      let o = p.sub(c);
      o = o.len() > 1e-7 ? o.norm() : axis;
      O.push(o);
      U.push(f.uv ? f.uv(i, s)[0] : s / ns, f.uv ? f.uv(i, s)[1] : i / (nr - 1));
      if (f.color) Cc.push(...f.color(i, th), 1);
      if (w) W.push(w);
    }
  }
  const w1 = ns + 1, acc = new Float64Array(P.length);
  const pt = (k) => new V3(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
  const tri = (a, b, c) => {
    const pa = pt(a), n = pt(b).sub(pa).cross(pt(c).sub(pa));
    if (n.len() < 1e-14) return;
    const out = O[a].add(O[b]).add(O[c]);
    const inward = n.dot(out) < 0;
    if (inward) I.push(a, b, c); else I.push(a, c, b);
    const no = inward ? n.mul(-1) : n;
    for (const k of [a, b, c]) { acc[3 * k] += no.x; acc[3 * k + 1] += no.y; acc[3 * k + 2] += no.z; }
  };
  for (let i = 0; i < nr - 1; i++) for (let s = 0; s < ns; s++) {
    if (f.keep && !f.keep(i + 0.5, TAU * (s + 0.5) / ns)) continue;
    const a = i * w1 + s, b = a + 1, c = a + w1, d = c + 1;
    tri(a, b, c); tri(b, d, c);
  }
  for (let i = 0; i < nr; i++) {                       // weld the seam column
    const a = i * w1, b = a + ns;
    for (let k = 0; k < 3; k++) { const v = acc[3 * a + k] + acc[3 * b + k]; acc[3 * a + k] = acc[3 * b + k] = v; }
  }
  for (let k = 0; k < P.length / 3; k++) {
    let x = acc[3 * k], y = acc[3 * k + 1], z = acc[3 * k + 2], l = Math.hypot(x, y, z);
    if (l < 1e-12) { x = O[k].x; y = O[k].y; z = O[k].z; l = 1; }
    N.push(x / l, y / l, z / l);
  }
  const g = { positions: P, normals: N, uvs: U, indices: I };
  if (f.color) g.colors = Cc;
  if (W.length) Object.assign(g, packWeights(W));
  return g;
}
function packWeights(W) {
  const idx = [], wt = [];
  for (const w of W) {
    const e = Object.entries(w).filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = e.reduce((s, [, v]) => s + v, 0) || 1;
    for (let k = 0; k < 4; k++) {
      if (k < e.length) { idx.push(JOINTS.indexOf(e[k][0])); wt.push(e[k][1] / sum); } else { idx.push(0); wt.push(0); }
    }
  }
  return { matricesIndices: idx, matricesWeights: wt };
}
const mixW = (a, b, t) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = (o[k] || 0) + v * (1 - t); for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v * t; return o; };
function xform(g, M) {                         // rigid 4x4 (row-vector) applied to a mesh
  const P = g.positions, Nn = g.normals;
  for (let k = 0; k < P.length; k += 3) {
    const x = P[k], y = P[k + 1], z = P[k + 2];
    P[k] = x * M[0] + y * M[4] + z * M[8] + M[12]; P[k + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; P[k + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
    const a = Nn[k], b = Nn[k + 1], c = Nn[k + 2];
    Nn[k] = a * M[0] + b * M[4] + c * M[8]; Nn[k + 1] = a * M[1] + b * M[5] + c * M[9]; Nn[k + 2] = a * M[2] + b * M[6] + c * M[10];
  }
  return g;
}

// ------------------------------------------------------------------ torso
// [y above pelvis joint, half-width, half-depth, weights]   (units of H)
const TORSO = [
  [-0.050, 0.000, 0.000, { pelvis: 1 }],
  [-0.046, 0.055, 0.040, { pelvis: 1 }],
  [-0.035, 0.077, 0.055, { pelvis: 1 }],
  [-0.015, 0.0835, 0.0595, { pelvis: 1 }],
  [0.020, 0.0828, 0.0575, { pelvis: 0.8, spine: 0.2 }],
  [0.055, 0.080, 0.052, { pelvis: 0.35, spine: 0.65 }],
  [0.085, 0.077, 0.049, { spine: 1 }],
  [0.125, 0.082, 0.051, { spine: 0.85, chest: 0.15 }],
  [0.165, 0.089, 0.055, { spine: 0.5, chest: 0.5 }],
  [0.195, 0.093, 0.058, { spine: 0.2, chest: 0.8 }],
  [0.225, 0.095, 0.059, { chest: 1 }],
  [0.258, 0.097, 0.058, { chest: 1 }],
  [0.283, 0.104, 0.053, { chest: 1 }],
  [0.299, 0.106, 0.046, { chest: 1 }],
  [0.311, 0.080, 0.042, { chest: 0.85, neck: 0.15 }],
  [0.321, 0.060, 0.039, { chest: 0.6, neck: 0.4 }],
  [0.331, 0.0335, 0.032, { chest: 0.3, neck: 0.7 }],
  [0.350, 0.0262, 0.0288, { neck: 1 }],
  [0.372, 0.0255, 0.0282, { neck: 0.6, head: 0.4 }],
  [0.392, 0.0250, 0.0272, { neck: 0.2, head: 0.8 }],
  [0.404, 0.016, 0.017, { head: 1 }],
  [0.408, 0.000, 0.000, { head: 1 }],
];
function torsoShape(y, th, H) {
  // superellipse cross-section with pectorals, shoulder blades and a spine groove
  const c = Math.cos(th), s = Math.sin(th);
  const p = 2.0 / lerp(2.15, 2.4, smooth((y - 0.12) / 0.12));
  let fx = sexp(c, p), fz = sexp(s, p);
  let k = 1;
  const chest = gauss(y - 0.245, 0.03);
  k += 0.045 * chest * (gauss(angDist(th, 60 * DEG), 0.35) + gauss(angDist(th, 120 * DEG), 0.35));  // pecs
  k += 0.03 * chest * (gauss(angDist(th, 235 * DEG), 0.3) + gauss(angDist(th, 305 * DEG), 0.3));   // scapulae
  k -= 0.03 * smooth((y - 0.06) / 0.05) * (1 - smooth((y - 0.3) / 0.02)) * gauss(angDist(th, 270 * DEG), 0.12); // spine groove
  k -= 0.025 * gauss(y - 0.09, 0.03) * gauss(angDist(th, 90 * DEG), 0.6);                          // flat belly
  k += 0.03 * gauss(y + 0.02, 0.03) * gauss(angDist(th, 270 * DEG), 0.5);                           // glutes
  k -= 0.09 * smooth((0.035 - y) / 0.07) * gauss(angDist(th, 90 * DEG), 0.55);                       // flat lower abdomen / front of the pelvis
  return [fx * k, fz * k];
}
function torsoRow(y) {
  for (let i = 1; i < TORSO.length; i++) {
    if (y <= TORSO[i][0] + 1e-12) {
      const a = TORSO[i - 1], b = TORSO[i], t = clamp01((y - a[0]) / (b[0] - a[0]));
      return [y, lerp(a[1], b[1], t), lerp(a[2], b[2], t), mixW(a[3], b[3], t)];
    }
  }
  return TORSO[TORSO.length - 1].slice();
}
function torsoSurface(av, { off = 0, ys = null, ns = 40, keep = null, row = torsoRow } = {}) {
  const H = av.H, base = av.j.pelvis.worldPos();
  let Y = ys;
  if (!Y) { Y = []; TORSO.forEach((r, i) => { Y.push(r[0]); if (i < TORSO.length - 1) Y.push((r[0] + TORSO[i + 1][0]) / 2); }); }
  const R = Y.map(row);
  const zOff = (y) => -0.004 * smooth((y - 0.32) / 0.04);           // neck sits behind the skull centre
  return grid(R.length, ns, {
    center: (i) => new V3(base.x, base.y + R[i][0] * H, base.z + zOff(R[i][0]) * H),
    point: (i, th) => {
      const [y, rx, rz] = R[i], [fx, fz] = torsoShape(y, th, H);
      const o = rx > 0 ? off : 0;
      return new V3(base.x + (rx + o) * fx * H, base.y + y * H, base.z + ((rz + o) * fz + zOff(y)) * H);
    },
    weights: (i) => R[i][3],
    keep: keep ? (im, th) => keep(lerp(R[Math.floor(im)][0], R[Math.ceil(im)][0], im - Math.floor(im)), th) : null,
    uv: (i, s) => [s / ns, (R[i][0] - R[0][0]) / (R[R.length - 1][0] - R[0][0])],
  });
}

// ------------------------------------------------------------------ limbs
// [distance below the joint, radius, x-scale, z-scale]
const ARM = [
  [-0.019, 0.000, 1, 1], [-0.017, 0.011, 1, 1], [-0.012, 0.019, 0.95, 1], [-0.006, 0.0235, 0.93, 1], [0.000, 0.0262, 0.93, 1.0],
  [0.030, 0.0262, 0.95, 1.03], [0.060, 0.025, 0.95, 1.05], [0.090, 0.0245, 0.94, 1.07], [0.120, 0.023, 0.95, 1.05],
  [0.150, 0.020, 1.0, 1.0], [0.172, 0.0186, 1.05, 0.98], [0.186, 0.0182, 1.06, 0.98], [0.202, 0.0198, 1.04, 1.0],
  [0.228, 0.0222, 1.02, 1.02], [0.258, 0.0208, 1.04, 0.96], [0.288, 0.0180, 1.08, 0.88], [0.314, 0.0158, 1.12, 0.80],
  [0.332, 0.0150, 1.14, 0.76], [0.341, 0.0132, 1.14, 0.74], [0.347, 0.0085, 1.1, 0.7], [0.349, 0.000, 1, 1],
];
const LEG = [
  [-0.034, 0.000, 1, 1], [-0.030, 0.026, 0.86, 1], [-0.020, 0.037, 0.86, 1], [0.000, 0.0435, 0.87, 1.02], [0.040, 0.0452, 0.91, 1.02],
  [0.080, 0.0448, 0.94, 1.02], [0.120, 0.0428, 0.95, 1.02], [0.160, 0.0392, 0.96, 1.02], [0.200, 0.0350, 0.97, 1.0],
  [0.228, 0.032, 1.0, 0.98], [0.245, 0.0315, 1.02, 0.98], [0.262, 0.0312, 1.0, 1.0], [0.285, 0.033, 0.95, 1.08],
  [0.312, 0.0345, 0.93, 1.12], [0.345, 0.031, 0.95, 1.06], [0.385, 0.025, 0.98, 1.0], [0.425, 0.021, 1.0, 0.98],
  [0.460, 0.0195, 1.0, 0.98], [0.482, 0.0188, 1.0, 1.0], [0.498, 0.0175, 1.0, 1.05], [0.509, 0.0115, 1, 1.05], [0.514, 0.000, 1, 1],
];
function armWeights(d, s, L, H) {
  const ua = L.upper_arm / H, fa = L.forearm / H;
  const e = smooth((d - (ua - 0.034)) / 0.06);                           // shoulder -> elbow across the joint
  let w = mixW({ [`shoulder_${s}`]: 1 }, { [`elbow_${s}`]: 1 }, e);
  if (d > ua) {
    const u = clamp01((d - ua) / fa);
    w = mixW(w, mixW({ [`elbow_${s}`]: 1 }, { [`twist_${s}`]: 1 }, u), smooth((d - ua) / 0.02));  // spread forearm twist
    w = mixW(w, { [`wrist_${s}`]: 1 }, 0.5 * smooth((d - (ua + fa - 0.012)) / 0.02));
  }
  return w;
}
function legWeights(d, s, L, H) {
  const th = L.thigh / H, sh = L.shank / H;
  let w = mixW({ [`hip_${s}`]: 1 }, { [`knee_${s}`]: 1 }, smooth((d - (th - 0.03)) / 0.06));
  w = mixW(w, { pelvis: 1 }, 0.35 * (1 - smooth((d + 0.01) / 0.09)));     // upper thigh blends into the hip
  w = mixW(w, { [`ankle_${s}`]: 1 }, smooth((d - (th + sh - 0.035)) / 0.045));
  return w;
}
/** A limb hanging straight down from `top` (bind pose), mirrored for the left side. */
function limb(av, top, rows, side, wfn, opts = {}) {
  const H = av.H, sx = side === 'R' ? 1 : -1, off = opts.off || 0, ns = opts.ns || 28;
  const R = opts.d0 != null ? rows.filter((r) => r[0] >= opts.d0 && r[0] <= opts.d1) : rows;
  return grid(R.length, ns, {
    center: (i) => new V3(top.x, top.y - R[i][0] * H, top.z),
    point: (i, th) => {
      const [d, r, kx, kz] = R[i];
      let k = 1;
      if (opts.shape) k = opts.shape(d, th);
      const rr = r > 0 ? r + off : 0;
      // ring parameter runs from the outer side (th = 0) so mirrored limbs map textures alike
      return new V3(top.x + sx * Math.cos(th) * rr * kx * k * H, top.y - d * H, top.z + Math.sin(th) * rr * kz * k * H);
    },
    weights: (i) => wfn(R[i][0], side),
    uv: (i, s) => [s / ns, i / (R.length - 1)],
  });
}
const legShape = (d, th) => {
  let k = 1;
  k += 0.10 * gauss(d - 0.315, 0.03) * gauss(angDist(th, 270 * DEG), 0.6);   // calf
  k += 0.05 * gauss(d - 0.30, 0.02) * gauss(angDist(th, 315 * DEG), 0.35);   // inner gastrocnemius
  k += 0.06 * gauss(d - 0.243, 0.012) * gauss(angDist(th, 90 * DEG), 0.45);  // kneecap
  k += 0.05 * gauss(d - 0.17, 0.04) * gauss(angDist(th, 60 * DEG), 0.5);    // quad (vastus lateralis)
  k += 0.03 * gauss(d - 0.20, 0.025) * gauss(angDist(th, 140 * DEG), 0.4);  // vastus medialis
  return k;
};
const armShape = (d, th) => {
  let k = 1;
  k += 0.08 * gauss(d - 0.085, 0.035) * gauss(angDist(th, 90 * DEG), 0.6);   // biceps (front)
  k += 0.06 * gauss(d - 0.07, 0.04) * gauss(angDist(th, 270 * DEG), 0.6);    // triceps
  k += 0.05 * gauss(d - 0.0, 0.025) * gauss(angDist(th, 0), 0.9);            // deltoid
  k += 0.07 * gauss(d - 0.226, 0.025) * gauss(angDist(th, 30 * DEG), 0.6);   // forearm flexors / brachioradialis
  return k;
};

// ------------------------------------------------------------------ clothing cut lines (shared with the texture painters)
export const JERSEY = { y0: 0.060, y1: 0.318, off: 0.0050 };
// a singlet hangs straight from the chest instead of hugging the waist
const DRAPE = [[0.06, 0.0835, 0.0575], [0.10, 0.0895, 0.0605], [0.15, 0.0945, 0.0625], [0.20, 0.0985, 0.0640], [0.24, 0.0, 0.0]];
export function jerseyRow(y) {
  const [y_, rx, rz, w] = torsoRow(y), o = JERSEY.off, [dx, dz] = table(DRAPE, y);
  return [y_, Math.max(rx + o, dx), Math.max(rz + o, dz), w];
}
/** true where the singlet has cloth: deep armholes, ~5 cm straps, modest round neck */
export function jerseyCut(y, th) {
  const [, rx, rz] = jerseyRow(y), [fx, fz] = torsoShape(y, th);
  const x = Math.abs(rx * fx), z = rz * fz;
  const armX = lerp(rx + 0.01, 0.083, smooth((y - 0.200) / 0.075));    // armhole: everything outside this |x|
  if (y > 0.200 && x > armX) return false;
  const neckF = 0.047 * smooth((y - 0.268) / 0.040);                   // front neckline
  const neckB = 0.045 * smooth((y - 0.296) / 0.020);                   // back neckline
  if (z > 0 && x < neckF) return false;
  if (z <= 0 && x < neckB) return false;
  return true;
}

// ------------------------------------------------------------------ head
const HEAD_AX = [0.0495, 0.0655, 0.0595];
function headPoint(d) {
  // ellipsoid along direction d, then sculpted: jaw, chin, sockets, brow, nose, cheeks, lips
  const t = 1 / Math.hypot(d.x / HEAD_AX[0], d.y / HEAD_AX[1], d.z / HEAD_AX[2]);
  let x = d.x * t, y = d.y * t, z = d.z * t;
  const lower = smooth((-y - 0.004) / 0.058);
  x *= 1 - 0.13 * lower * lower;
  x += Math.sign(x) * 0.0028 * gauss(y + 0.036, 0.011) * gauss(z + 0.004, 0.022);   // jaw angle
  if (z < 0) z *= 1 - 0.22 * lower;
  const front = smooth(z / 0.045);
  z += 0.006 * lower * front;
  y -= 0.006 * lower * lower * front;                                  // longer face, defined jaw line
  const fm = smooth((z - 0.018) / 0.03);
  for (const ex of [-0.0205, 0.0205]) z -= 0.0088 * gauss(Math.hypot((x - ex) * 0.9, (y - 0.0075) * 1.45), 0.0102) * fm;   // eye sockets
  z += 0.0040 * gauss(y - 0.0205, 0.0052) * gauss(x, 0.032) * fm;                                                  // brow ridge
  const cb = gauss(Math.hypot(Math.abs(x) - 0.033, y + 0.006), 0.011);
  z += 0.0032 * cb * fm; x += Math.sign(x) * 0.0018 * cb;                                                           // cheekbones
  // nose: ridge growing toward the tip, wider at the nostrils
  let h, sn;
  if (y >= -0.011) { const u = clamp01((0.016 - y) / 0.027); h = 0.0185 * Math.pow(u, 1.3); sn = 0.0034 + 0.0040 * u * u; }
  else { h = 0.0185 * gauss(y + 0.011, 0.0040); sn = 0.0072; }
  z += h * gauss(x, sn) * fm;
  z += 0.0026 * gauss(Math.hypot(Math.abs(x) - 0.0085, y + 0.0105), 0.0036) * fm;                                   // nostril wings
  z -= 0.0022 * gauss(Math.hypot(Math.abs(x) - 0.0135, y + 0.010), 0.0022) * fm;                                    // alar creases
  z -= 0.0018 * gauss(Math.hypot(Math.abs(x) - 0.020, y + 0.018), 0.006) * fm;                                      // nasolabial
  z += 0.0046 * gauss(y + 0.0232, 0.0028) * gauss(x, 0.0118) * fm;                                                 // upper lip
  z += 0.0052 * gauss(y + 0.0312, 0.0033) * gauss(x, 0.0104) * fm;                                                 // lower lip
  z -= 0.0024 * gauss(y + 0.0272, 0.0011) * gauss(x, 0.0112) * fm;
  z -= 0.0016 * gauss(y + 0.0385, 0.0028) * gauss(x, 0.012) * fm;                                                 // chin crease                                                 // mouth line
  z += 0.0052 * gauss(y + 0.050, 0.008) * gauss(x, 0.0145) * fm;                                                   // chin
  return new V3(x, y, z);
}
const HAIRLINE = [[0, 0.041], [35, 0.037], [62, 0.026], [80, 0.017], [100, 0.011], [128, -0.012], [155, -0.030], [180, -0.036]];
const hairlineAt = (az) => table(HAIRLINE, Math.abs(az) / DEG)[0];
function headGrid(H, off = 0, keep = null, color = null) {
  const nr = 58, ns = 92;   // uv: u = azimuth (0 front), v = polar from the chin pole
  // th = 0 is the back of the head so the mesh seam is hidden there
  const dir = (i, th) => { const ph = Math.PI * i / (nr - 1), t = th + Math.PI; return new V3(Math.sin(ph) * Math.sin(t), -Math.cos(ph), Math.sin(ph) * Math.cos(t)); };
  const pt = (i, th) => {
    const p = headPoint(dir(i, th));
    if (!off) return p.mul(H);
    const thick = off(p, th + Math.PI);
    return p.add(p.norm().mul(thick)).mul(H);
  };
  return grid(nr, ns, {
    center: (i) => new V3(0, -Math.cos(Math.PI * i / (nr - 1)) * 0.02 * H, 0),
    point: pt,
    keep: keep ? (im, th) => keep(headPoint(dir(im, th)), th + Math.PI) : null,
    color: color ? (i, th) => color(headPoint(dir(i, th))) : null,
    uv: (i, s) => [s / ns, i / (nr - 1)],
  });
}
const azim = (th) => (th > Math.PI ? th - TAU : th);   // th: 0 = front, +90 deg = right
/** Height above the hairline (H units) of the scalp point at hair-texture (u, v). */
export function hairAbove(u, v) {
  const ph = Math.PI * v, th = TAU * u + Math.PI;
  const p = headPoint(new V3(Math.sin(ph) * Math.sin(th), -Math.cos(ph), Math.sin(ph) * Math.cos(th)));
  return p.y - hairlineAt(azim(th));
}

// ------------------------------------------------------------------ hands & shoes
function ellipsoid(c, r, rings = 10, segs = 14) {
  return grid(rings + 1, segs, {
    center: () => new V3(...c),
    point: (i, th) => { const ph = Math.PI * i / rings; return new V3(c[0] + Math.sin(ph) * Math.cos(th) * r[0], c[1] - Math.cos(ph) * r[1], c[2] + Math.sin(ph) * Math.sin(th) * r[2]); },
  });
}
function capsuleY(len, r0, r1, sz = 1, segs = 12) {
  // from y = 0 down to y = -len, radius r0 -> r1, rounded ends
  const R = [];
  for (let k = 0; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; R.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }            // top cap: y up to +r0
  for (let k = 1; k <= 5; k++) { const u = k / 6; R.push([-len * u, r0 + (r1 - r0) * u]); }
  for (let k = 0; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; R.push([-len - r1 * Math.sin(a), r1 * Math.cos(a)]); }
  return grid(R.length, segs, {
    center: (i) => new V3(0, R[i][0], 0),
    point: (i, th) => new V3(Math.cos(th) * R[i][1], R[i][0], Math.sin(th) * R[i][1] * sz),
  });
}
function palm(H, sx) {
  const R = [[0.004, 0.0, 0.0], [0.003, 0.012, 0.008], [0.0, 0.0168, 0.0108], [-0.012, 0.0195, 0.0122], [-0.030, 0.0222, 0.0125],
    [-0.048, 0.0228, 0.0112], [-0.055, 0.0215, 0.0094], [-0.0595, 0.0150, 0.0068], [-0.0612, 0.0, 0.0]];
  return grid(R.length, 24, {
    center: (i) => new V3(0, R[i][0] * H, 0),
    point: (i, th) => { const c = Math.cos(th), s = Math.sin(th); const k = 1 + 0.08 * gauss(R[i][0] + 0.03, 0.02) * gauss(angDist(th, sx > 0 ? Math.PI : 0), 0.5);
      return new V3(sexp(c, 0.6) * R[i][1] * k * H, R[i][0] * H, sexp(s, 0.75) * R[i][2] * H - (s < 0 ? 0.0015 * H * gauss(R[i][0] + 0.03, 0.015) : 0)); },
  });
}
const SHOE_W = [[0, 0.0205], [0.1, 0.0262], [0.3, 0.0258], [0.5, 0.0302], [0.68, 0.0334], [0.82, 0.0318], [0.93, 0.0252], [1, 0.016]];
const SHOE_H = [[0, 0.049], [0.17, 0.051], [0.30, 0.044], [0.45, 0.035], [0.6, 0.0275], [0.75, 0.022], [0.88, 0.018], [1, 0.011]];
function shoeFrame(t, L, H) {
  const fl = L.foot * 1.04, z0 = -0.235 * fl, z1 = 0.78 * fl, g = -L.ankle_h;
  const eh = Math.sqrt(1 - (1 - clamp01(t / 0.09)) ** 2), et = Math.sqrt(1 - (1 - clamp01((1 - t) / 0.16)) ** 2);
  const lift = 0.0065 * H * smooth((t - 0.78) / 0.22) ** 2 + 0.002 * H * (1 - smooth(t / 0.1));
  return { z: z0 + t * (z1 - z0), w: table(SHOE_W, t)[0] * H * eh * et, h: table(SHOE_H, t)[0] * H * Math.sqrt(eh * et), g, lift, ys: g + 0.0118 * H + lift };
}
function shoeUpper(L, H, sx) {
  const nr = 40;
  return grid(nr, 36, {
    center: (i) => { const f = shoeFrame(i / (nr - 1), L, H); return new V3(0, f.ys + f.h * 0.4, f.z); },
    point: (i, th) => {
      const t = i / (nr - 1), f = shoeFrame(t, L, H), c = Math.cos(th), s = Math.sin(th);
      const inner = sx * c < 0 ? 0.94 : 1;                       // slightly straighter medial side
      const y = s >= 0 ? f.ys + f.h * Math.pow(s, 0.5) : f.ys - 0.002 * H * (-s);
      const taper = s > 0 ? 1 - 0.18 * Math.pow(s, 3) : 1;
      return new V3(sexp(c, 0.8) * f.w * inner * taper, y, f.z);
    },
    uv: (i, s) => [s / 36, i / (nr - 1)],
  });
}
function shoeSole(L, H, sx, top, bot, extra) {
  const nr = 34;
  return grid(nr, 28, {
    center: (i) => { const f = shoeFrame(i / (nr - 1), L, H); return new V3(0, f.g + f.lift + (top + bot) / 2 * H, f.z); },
    point: (i, th) => {
      const t = i / (nr - 1), f = shoeFrame(t, L, H), c = Math.cos(th), s = Math.sin(th);
      const hh = (top - bot) / 2 * H, yc = f.g + f.lift + (top + bot) / 2 * H;
      return new V3(sexp(c, 0.32) * (f.w + extra * H), yc + sexp(s, 0.32) * hh, f.z + (t < 0.02 ? -extra * H * 0.5 : t > 0.98 ? extra * H * 0.5 : 0));
    },
  });
}

// ------------------------------------------------------------------ assemble
/**
 * Builds the render recipe for an Avatar (call from its constructor, bind pose).
 * Returns { skinned: [{name, mat, geo}], rigid: [{node, geo:{type:'mesh', data}, mat}], bind: {joint: matrix} }.
 */
export function buildBody(av) {
  Node.dirty();
  const H = av.H, L = av.L, rigid = [], skinned = [];
  const bind = Object.fromEntries(JOINTS.map((n) => [n, av.j[n].world().slice()]));
  const S = (name, geo, mat) => skinned.push({ name, geo, mat });
  const R = (node, data, mat) => rigid.push({ node, geo: { type: 'mesh', data }, mat });

  // body ---------------------------------------------------------------
  S('torso', torsoSurface(av), 'skin');
  for (const s of ['R', 'L']) {
    const sh = av.j[`shoulder_${s}`].worldPos(), hip = av.j[`hip_${s}`].worldPos();
    S(`arm_${s}`, limb(av, sh, ARM, s, (d) => armWeights(d, s, L, H), { shape: armShape }), 'skin');
    S(`leg_${s}`, limb(av, hip, LEG, s, (d) => legWeights(d, s, L, H), { shape: legShape }), 'skin');
    // crew sock above the high-top
    const legR = (d) => table(LEG.map((r) => [r[0], r[1]]), d)[0];
    const sock = [[0.404, 0.0, 1, 1], [0.405, legR(0.405) - 0.0006, 1, 1], ...LEG.filter((r) => r[0] > 0.41 && r[0] < 0.5), [0.5, 0.0185, 1, 1.05]];
    S(`sock_${s}`, limb(av, hip, sock, s, (d) => legWeights(d, s, L, H), { off: 0.0026, shape: legShape }), 'sock');
  }

  // clothing -------------------------------------------------------------
  const jy = []; for (let y = JERSEY.y0; y <= JERSEY.y1 + 1e-9; y += 0.008) jy.push(Math.min(y, JERSEY.y1));
  if (jy[jy.length - 1] < JERSEY.y1 - 1e-6) jy.push(JERSEY.y1);
  S('jersey', torsoSurface(av, { ys: jy, ns: 64, row: jerseyRow }), 'jersey');
  // shorts: waist-to-crotch piece plus a loose tube per leg (they overlap like one garment)
  const pel = av.j.pelvis.worldPos();
  const SH = [[0.079, 0.0856, 0.0596], [0.072, 0.0864, 0.0604], [0.040, 0.0870, 0.0616], [0.000, 0.0874, 0.0644], [-0.028, 0.0858, 0.0636], [-0.044, 0.0770, 0.0560], [-0.051, 0.048, 0.037], [-0.054, 0.0, 0.0]];
  S('shorts', grid(SH.length, 40, {
    center: (i) => new V3(pel.x, pel.y + SH[i][0] * H, pel.z),
    point: (i, th) => { const [y, rx, rz] = SH[i], [fx, fz] = torsoShape(y, th, H); return new V3(pel.x + rx * fx * H, pel.y + y * H, pel.z + rz * fz * H); },
    weights: () => ({ pelvis: 1 }),
    uv: (i, s) => [s / 40, 1 - i / (SH.length - 1)],
  }), 'shorts');
  for (const s of ['R', 'L']) {
    const hip = av.j[`hip_${s}`].worldPos(), sx = s === 'R' ? 1 : -1, top = new V3(hip.x - sx * 0.0025 * H, hip.y, hip.z);
    const rows = [[-0.030, 0.0405, 0.90, 1.12], [0.000, 0.0466, 0.92, 1.12], [0.050, 0.0496, 0.95, 1.10], [0.110, 0.0520, 0.97, 1.06], [0.168, 0.0536, 0.99, 1.03], [0.170, 0.0500, 0.99, 1.03]];
    S(`shorts_${s}`, limb(av, top, rows, s, (d) => legWeights(d, s, L, H), { ns: 32 }), 'shortsLeg');      // same skinning as the thigh underneath
  }

  // head -----------------------------------------------------------------
  const hc = av.head_center;
  hc.scale = [1.07, 1.07, 1.07];                       // juniors have proportionally larger heads
  const lipCol = (p) => {
    const fm = smooth((p.z - 0.02) / 0.02), ax = Math.abs(p.x);
    const l = gauss(p.y + 0.0275, 0.0052) * gauss(p.x, 0.012) * smooth((p.z - 0.04) / 0.01);
    const ch = 0.5 * gauss(Math.hypot(ax - 0.03, p.y + 0.012), 0.012) * smooth(p.z / 0.04);
    let ao = 0;                                                                     // baked cavity shading
    ao += 0.22 * gauss(Math.hypot(ax - 0.0205, (p.y - 0.009) * 1.3), 0.0085) * fm;    // eye sockets
    ao += 0.12 * gauss(Math.hypot(ax - 0.010, p.y - 0.016), 0.004) * fm;              // inner brow / nose bridge sides
    ao += 0.55 * gauss(Math.hypot(ax - 0.0058, p.y + 0.0138), 0.0017) * fm;           // nostrils
    ao += 0.30 * gauss(p.y + 0.0272, 0.0011) * gauss(p.x, 0.0118) * fm;              // mouth line
    ao += 0.14 * gauss(Math.hypot(ax - 0.0125, p.y + 0.0275), 0.0025) * fm;           // mouth corners
    ao += 0.12 * gauss(Math.hypot(ax - 0.017, p.y + 0.016), 0.005) * fm;              // nasolabial folds
    ao += 0.18 * smooth((-p.y - 0.045) / 0.02) * (1 - fm);                            // under the jaw
    ao += 0.10 * gauss(p.y + 0.0385, 0.003) * gauss(p.x, 0.012) * fm;                 // chin crease
    const hi = 0.06 * gauss(p.x, 0.004) * gauss(p.y - 0.002, 0.012) * fm;             // nose bridge highlight
    const k = 1 - ao + hi;
    return [(1 - 0.16 * l + 0.03 * ch) * k, (1 - 0.50 * l - 0.06 * ch) * k, (1 - 0.44 * l - 0.07 * ch) * k];
  };
  const headGeo = headGrid(H, 0, null, lipCol);
  R(hc, headGeo, 'skin');
  // eyes sit in the sockets: find the surface depth there
  const surfZ = (x, y) => { let best = Infinity, z = 0; const P = headGeo.positions; for (let k = 0; k < P.length; k += 3) { if (P[k + 2] <= 0) continue; const e = (P[k] / H - x) ** 2 + (P[k + 1] / H - y) ** 2; if (e < best) { best = e; z = P[k + 2] / H; } } return z; };
  // eyes: a well-exposed eyeball; upper and lower lids leave an almond-shaped opening
  const er = 0.0074;
  for (const ex of [-1, 1]) {
    const x = ex * 0.0205, y = 0.0075, z = surfZ(x, y) - er + 0.0052;
    const eye = new Node('eye', hc, [x * H, y * H, z * H], [0, ex * 6, 0]);
    R(eye, ellipsoid([0, 0, 0], [er * H, er * H, er * H], 14, 20), 'eyeWhite');
    R(eye, ellipsoid([0, 0, (er - 0.0010) * H], [0.0038 * H, 0.0038 * H, 0.0014 * H], 10, 18), 'iris');
    R(eye, ellipsoid([0, 0, (er - 0.0001) * H], [0.0016 * H, 0.0016 * H, 0.0006 * H], 6, 12), 'pupil');
    // lid: spherical cap around an axis at `elev` degrees above straight ahead, ending `edge` deg from the axis;
    // the free edge is darkened (lash line)
    const lid = (elev, edge, rr, lash) => grid(13, 24, {
      center: () => new V3(0, 0, 0),
      point: (i, th) => {
        const ph = edge * DEG * i / 12, p = new V3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)).mul(rr * H);
        const a = (90 - elev) * DEG, c = Math.cos(a), s = Math.sin(a);
        return new V3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
      },
      color: (i) => { const k = 1 - lash * smooth((i - 10.2) / 1.8); return [k, k, k]; },
    });
    R(eye, lid(96, 79, er + 0.0011, 0.78), 'skin');      // upper lid edge at +17 deg (relaxed, not staring)
    R(eye, lid(-86, 62, er + 0.0008, 0.35), 'skin');     // lower lid edge at -24 deg
    const brow = new Node('brow', hc, [ex * 0.0215 * H, 0.0195 * H, (surfZ(ex * 0.0215, 0.0195) - 0.0011) * H], [0, ex * 10, ex * -6]);
    R(brow, ellipsoid([0, 0, 0], [0.0128 * H, 0.0015 * H, 0.0030 * H], 6, 12), 'brow');
    // ears
    const ear = new Node('ear', hc, [ex * 0.0466 * H, -0.002 * H, -0.007 * H], [0, ex * -12, ex * -5]);
    R(ear, ellipsoid([ex * 0.003 * H, 0, 0], [0.0050 * H, 0.0196 * H, 0.0122 * H], 10, 16), 'skin');
    R(ear, ellipsoid([ex * 0.0050 * H, 0.002 * H, -0.001 * H], [0.0018 * H, 0.0128 * H, 0.0072 * H], 8, 12), 'earInner');
  }
  // short hair: a shell over the scalp, thicker on top and feathered to nothing at the
  // hairline; the exact (slightly ragged) hairline is cut by the hair texture's alpha
  R(hc, headGrid(H, (p, th) => {
    const above = p.y - hairlineAt(azim(th));
    return Math.max(0.0002, 0.0024 * smooth(above / 0.012) + 0.0058 * smooth((p.y - 0.01) / 0.05));
  }, (p) => p.y > -0.045), 'hair');

  // hands ----------------------------------------------------------------
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? 1 : -1, w = av.j[`wrist_${s}`], pl = 0.056 * H;
    R(w, palm(H, sx), 'skin');
    R(w, ellipsoid([-sx * 0.0105 * H, -0.022 * H, -0.0045 * H], [0.0105 * H, 0.020 * H, 0.0085 * H], 8, 12), 'skin');   // thenar
    [-0.0145, -0.005, 0.005, 0.0145].forEach((fx, k) => {
      const ln = [0.040, 0.047, 0.050, 0.046][k] * H, seg = [0.45, 0.31, 0.24].map((f) => f * ln);
      const r0 = [0.0058, 0.0063, 0.0064, 0.0062][k] * H;
      let node = new Node('finger', w, [fx * H * -sx, -pl + 0.003 * H, 0.0005 * H], [10, 0, -sx * (k - 1.5) * 3]);
      seg.forEach((sl, n) => {
        const ra = r0 * (1 - 0.1 * n), rb = r0 * (0.9 - 0.1 * n);
        R(node, capsuleY(sl, ra, rb, 0.86), 'skin');
        if (n === 2) R(node, ellipsoid([0, -sl * 0.62, rb * 0.62], [rb * 0.82, sl * 0.42, rb * 0.32], 6, 10), 'nail');
        if (n < 2) node = new Node('phalanx', node, [0, -sl, 0], [[12, 9][n], 0, 0]);
      });
    });
    let th = new Node('thumb', w, [-sx * 0.0175 * H, -0.017 * H, -0.006 * H], [10, sx * 25, -sx * 38]);
    R(th, capsuleY(0.023 * H, 0.0088 * H, 0.0074 * H, 0.9), 'skin');
    th = new Node('thumb2', th, [0, -0.023 * H, 0], [8, 0, 0]);
    R(th, capsuleY(0.019 * H, 0.0074 * H, 0.0064 * H, 0.86), 'skin');
    R(th, ellipsoid([0, -0.019 * H * 0.6, 0.0064 * H * 0.6], [0.0054 * H, 0.0078 * H, 0.002 * H], 6, 10), 'nail');
  }

  // sneakers -------------------------------------------------------------
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? 1 : -1, a = av.j[`ankle_${s}`];
    const mir = (g) => { if (sx < 0) { for (let k = 0; k < g.positions.length; k += 3) { g.positions[k] *= -1; g.normals[k] *= -1; } for (let k = 0; k < g.indices.length; k += 3) { const t = g.indices[k + 1]; g.indices[k + 1] = g.indices[k + 2]; g.indices[k + 2] = t; } } return g; };
    R(a, mir(shoeUpper(L, H, 1)), 'shoeTex');
    R(a, mir(shoeSole(L, H, 1, 0.0128, 0.0040, 0.0022)), 'midsole');
    R(a, mir(shoeSole(L, H, 1, 0.0047, 0.0, 0.0030)), 'sole');
  }
  return { skinned, rigid, bind };
}
