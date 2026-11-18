// Empty arena bowl: two tiers of stepped concrete with individually modelled
// seats (thin instances, one draw call per tier), aisle stairs with yellow
// nosing, handrails, a padded front wall, a suite level, an LED ribbon fascia,
// exit signs and the building shell. Everything follows a rounded-rectangle
// path around the court.
/* global BABYLON */
import * as C from './config.js';

const B = () => window.BABYLON;
const TAU = Math.PI * 2;
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- geometry builder
// Normals are stored facing the side Babylon treats as the front face; materials are
// two-sided with twoSidedLighting, so winding never matters.
class Geo {
  constructor() { this.P = []; this.N = []; this.C = []; this.U = []; this.I = []; }
  tri(a, b, c, col, uv) {
    const i = this.P.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = -(uy * vz - uz * vy), ny = -(uz * vx - ux * vz), nz = -(ux * vy - uy * vx); const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { this.P.push(p[0], p[1], p[2]); this.N.push(nx, ny, nz); this.C.push(col[0], col[1], col[2], 1); }
    if (uv) this.U.push(...uv[0], ...uv[1], ...uv[2]); else this.U.push(0, 0, 0, 0, 0, 0);
    this.I.push(i, i + 1, i + 2);
  }
  quad(a, b, c, d, col, uv) { this.tri(a, b, c, col, uv && [uv[0], uv[1], uv[2]]); this.tri(a, c, d, col, uv && [uv[0], uv[2], uv[3]]); }
  /** oriented box: centre + three half-axis vectors */
  obox(c, ax, ay, az, col, top = col) {
    const P = (i, j, k) => [c[0] + i * ax[0] + j * ay[0] + k * az[0], c[1] + i * ax[1] + j * ay[1] + k * az[1], c[2] + i * ax[2] + j * ay[2] + k * az[2]];
    this.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), top);
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), col);
    this.quad(P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1), col);
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), col);
    this.quad(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), col);
    this.quad(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), col);
  }
  mesh(name, scene, mat) {
    const m = new (B().Mesh)(name, scene), vd = new (B().VertexData)();
    Object.assign(vd, { positions: this.P, normals: this.N, colors: this.C, uvs: this.U, indices: this.I });
    vd.applyToMesh(m); m.material = mat; m.isPickable = false; m.freezeWorldMatrix();
    return m;
  }
}
function mat(scene, name, rgb, { spec = 0.05, emissive = 0, tex = null, vc = true } = {}) {
  const BABYLON = B(), m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(...rgb); m.specularColor = new BABYLON.Color3(spec, spec, spec); m.specularPower = 30;
  if (tex) m.diffuseTexture = tex;
  if (emissive) { m.emissiveColor = new BABYLON.Color3(emissive, emissive, emissive); if (tex) m.emissiveTexture = tex; m.disableLighting = emissive >= 1; }
  m.backFaceCulling = false; m.twoSidedLighting = true;
  return m;
}

// ---------------------------------------------------------------- the bowl path
// Rounded rectangle around the court: straight sides plus quarter-circle corners.
// pathAt(s, d) -> {p:[x,z], n:[nx,nz] outward, t:[tx,tz]} for arc-length s at offset d.
function makePath(ax, az, rc) {
  const sx = ax - rc, sz = az - rc;
  const segs = [];                                  // anticlockwise from the +x side
  const add = (type, a) => segs.push({ type, ...a });
  add('line', { p0: [ax, -sz], p1: [ax, sz], n: [1, 0] });
  add('arc', { c: [sx, sz], a0: 0, a1: Math.PI / 2 });
  add('line', { p0: [sx, az], p1: [-sx, az], n: [0, 1] });
  add('arc', { c: [-sx, sz], a0: Math.PI / 2, a1: Math.PI });
  add('line', { p0: [-ax, sz], p1: [-ax, -sz], n: [-1, 0] });
  add('arc', { c: [-sx, -sz], a0: Math.PI, a1: 1.5 * Math.PI });
  add('line', { p0: [-sx, -az], p1: [sx, -az], n: [0, -1] });
  add('arc', { c: [sx, -sz], a0: 1.5 * Math.PI, a1: TAU });
  return { segs, rc };
}
/** Sample points along the path at offset d (straights: ends only; arcs: every ~6 deg). */
function samples(path, d) {
  const out = [];
  let s = 0;
  for (const g of path.segs) {
    if (g.type === 'line') {
      const p0 = [g.p0[0] + g.n[0] * d, g.p0[1] + g.n[1] * d], p1 = [g.p1[0] + g.n[0] * d, g.p1[1] + g.n[1] * d];
      out.push({ p: p0, n: g.n, s }); s += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    } else {
      const R = path.rc + d, n = 15;
      for (let i = 0; i < n; i++) {
        const a = g.a0 + (g.a1 - g.a0) * i / n, nn = [Math.cos(a), Math.sin(a)];
        out.push({ p: [g.c[0] + nn[0] * R, g.c[1] + nn[1] * R], n: nn, s });
        s += R * (g.a1 - g.a0) / n;
      }
    }
  }
  out.push({ ...out[0], s });                       // close the loop
  return out;
}
/** Vertical / sloped strip swept along the path between (d0, y0) and (d1, y1). */
function sweep(geo, path, d0, y0, d1, y1, col, uvLen = 0) {
  const A = samples(path, d0), Bs = samples(path, d1);
  for (let i = 0; i < A.length - 1; i++) {
    const a = A[i], b = A[i + 1], c = Bs[i + 1], d = Bs[i];
    // u runs clockwise (seen from the court) so text reads left-to-right from inside the bowl
    const uv = uvLen ? [[-a.s / uvLen, 0], [-b.s / uvLen, 0], [-b.s / uvLen, 1], [-a.s / uvLen, 1]] : null;
    geo.quad([a.p[0], y0, a.p[1]], [b.p[0], y0, b.p[1]], [c.p[0], y1, c.p[1]], [d.p[0], y1, d.p[1]], col, uv);
  }
}
/** Walk seat / aisle positions along the path at offset d with spacing sp. */
function walk(path, d, sp, aisles, aisleHalf, fn) {
  path.segs.forEach((g, gi) => {
    if (g.type === 'line') {
      const p0 = [g.p0[0] + g.n[0] * d, g.p0[1] + g.n[1] * d], p1 = [g.p1[0] + g.n[0] * d, g.p1[1] + g.n[1] * d];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), t = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
      const n = Math.floor(L / sp), st = (L - (n - 1) * sp) / 2;
      for (let k = 0; k < n; k++) {
        const u = st + k * sp, p = [p0[0] + t[0] * u, p0[1] + t[1] * u];
        const along = g.n[0] ? p[1] : p[0];          // coordinate along this side
        if (aisles.line[g.n[0] ? 'side' : 'end'].some((q) => Math.abs(along - q) < aisleHalf)) continue;
        fn(p, g.n, t);
      }
    } else {
      const R = path.rc + d, L = R * (g.a1 - g.a0), n = Math.floor(L / sp), st = (L - (n - 1) * sp) / 2;
      for (let k = 0; k < n; k++) {
        const a = g.a0 + (st + k * sp) / R, nn = [Math.cos(a), Math.sin(a)];
        if (Math.abs(a - (g.a0 + g.a1) / 2) * R < aisleHalf) continue;      // corner aisle
        fn([g.c[0] + nn[0] * R, g.c[1] + nn[1] * R], nn, [-nn[1], nn[0]]);
      }
    }
  });
}
/** Aisle centre lines: positions + outward normals at offset d. */
function aislePoints(path, aisles, d) {
  const out = [], sx = path.segs[2].p0[0], sz = path.segs[0].p1[1];
  for (const g of path.segs) {
    if (g.type === 'line') {
      const key = g.n[0] ? 'side' : 'end';
      for (const q of aisles.line[key]) {
        const p = g.n[0] ? [g.p0[0] + g.n[0] * d, q] : [q, g.p0[1] + g.n[1] * d];
        out.push({ p, n: g.n });
      }
    } else {
      const a = (g.a0 + g.a1) / 2, nn = [Math.cos(a), Math.sin(a)], R = path.rc + d;
      out.push({ p: [g.c[0] + nn[0] * R, g.c[1] + nn[1] * R], n: nn });
    }
  }
  return out;
}

// ---------------------------------------------------------------- seat model
function seatGeo() {
  // origin at the middle of the tread, facing +z (toward the court); white so the
  // per-seat instance colour tints it; dark frame
  const g = new Geo(), white = [1, 1, 1], frame = [0.18, 0.18, 0.2];
  const tilt = (deg) => { const a = deg * Math.PI / 180; return [[0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)]]; };
  let [up, fw] = tilt(-6);
  g.obox([0, 0.44, 0.06], [0.225, 0, 0], up.map((v) => v * 0.03), fw.map((v) => v * 0.2), white);      // seat pan
  [up, fw] = tilt(-14);
  g.obox([0, 0.72, -0.16], [0.225, 0, 0], up.map((v) => v * 0.25), fw.map((v) => v * 0.025), white);   // back
  g.obox([0, 0.21, -0.02], [0.03, 0, 0], [0, 0.21, 0], [0, 0, 0.03], frame);                         // pedestal
  return g;
}

// ---------------------------------------------------------------- textures
function ribbonTexture(scene) {
  const t = new (B().DynamicTexture)('ribbonT', { width: 2048, height: 64 }, scene, true), ctx = t.getContext();
  const grd = ctx.createLinearGradient(0, 0, 2048, 0);
  grd.addColorStop(0, '#0a2a8c'); grd.addColorStop(0.5, '#1846c8'); grd.addColorStop(1, '#0a2a8c');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 2048, 64);
  ctx.fillStyle = '#ffd23c'; ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText('HOOPFORM  ·  SHOOT WITH FORM  ·  BALANCE  ·  EYES  ·  ELBOW  ·  FOLLOW-THROUGH  ·', 20, 34);
  t.update(); t.wrapU = B().Texture.WRAP_ADDRESSMODE;
  return t;
}
function suiteTexture(scene) {
  const t = new (B().DynamicTexture)('suiteT', { width: 512, height: 64 }, scene, true), ctx = t.getContext(), r = rng(5);
  ctx.fillStyle = '#121418'; ctx.fillRect(0, 0, 512, 64);
  for (let k = 0; k < 8; k++) {
    const lit = 0.55 + r() * 0.45;
    const g = ctx.createLinearGradient(0, 8, 0, 60);
    g.addColorStop(0, `rgba(255,214,150,${0.55 * lit})`); g.addColorStop(1, `rgba(150,110,70,${0.35 * lit})`);
    ctx.fillStyle = g; ctx.fillRect(k * 64 + 4, 8, 56, 52);
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(k * 64 + 30, 8, 3, 52);
  }
  t.update(); t.wrapU = B().Texture.WRAP_ADDRESSMODE;
  return t;
}

// ---------------------------------------------------------------- build
/**
 * Builds the bowl. Returns { meshes, seats:[mesh] } so the caller can decide what
 * the floor reflects.
 */
export function buildStadium(scene, { mobile = false, lite = false } = {}) {
  const BABYLON = B(), hx = C.COURT_WIDTH / 2, hz = C.COURT_LENGTH / 2, r = rng(17);
  const path = makePath(hx + 4.6, hz + 4.8, 4.2);
  const aisles = { line: { side: [-10.2, -3.4, 3.4, 10.2], end: [-4.4, 4.4] } };
  const concrete = [0.40, 0.40, 0.42], riserC = [0.30, 0.30, 0.32], yellow = [0.95, 0.75, 0.10], steel = [0.55, 0.56, 0.6];
  const geo = new Geo(), meshes = [], seatsOut = [];
  const tiers = [
    { d0: 0.0, y0: 1.05, rows: 15, D: 0.85, rise: (i) => 0.38 + 0.005 * i, seat: [0.06, 0.20, 0.62] },
    { d0: 11.9, y0: 10.7, rows: 12, D: 0.80, rise: () => 0.54, seat: [0.07, 0.16, 0.48] },
  ];
  for (const [ti, T] of tiers.entries()) {
    const rowsY = [T.y0];
    for (let i = 0; i < T.rows; i++) rowsY.push(rowsY[i] + T.rise(i));
    // stepped concrete: tread then riser for every row
    for (let i = 0; i < T.rows; i++) {
      const da = T.d0 + i * T.D, db = da + T.D;
      sweep(geo, path, da, rowsY[i], db, rowsY[i], concrete);
      sweep(geo, path, db, rowsY[i], db, rowsY[i + 1], riserC);
    }
    const dEnd = T.d0 + T.rows * T.D;
    // aisle stairs: an intermediate step on each row, yellow nosing, centre handrail
    for (let i = 0; i < T.rows; i++) {
      const da = T.d0 + i * T.D, y = rowsY[i], h = (rowsY[i + 1] - y) / 2;
      for (const a of aislePoints(path, aisles, da + T.D * 0.75)) {
        const t = [-a.n[1], a.n[0]], c = [a.p[0], y + h / 2, a.p[1]];
        geo.obox(c, [t[0] * 0.55, 0, t[1] * 0.55], [0, h / 2, 0], [a.n[0] * T.D / 4, 0, a.n[1] * T.D / 4], riserC, concrete);
      }
      for (const [dd, yy] of [[da, y], [da + T.D / 2, y + h]]) {
        for (const a of aislePoints(path, aisles, dd + 0.02)) {
          const t = [-a.n[1], a.n[0]];
          geo.obox([a.p[0], yy + 0.004, a.p[1]], [t[0] * 0.55, 0, t[1] * 0.55], [0, 0.004, 0], [a.n[0] * 0.025, 0, a.n[1] * 0.025], yellow);
        }
      }
      // handrail post + sloped rail segment up the aisle centre
      const p0 = aislePoints(path, aisles, da + 0.1), p1 = aislePoints(path, aisles, da + T.D + 0.1);
      p0.forEach((a, k) => {
        const b = p1[k], y1 = rowsY[i + 1];
        geo.obox([a.p[0], y + 0.45, a.p[1]], [0.02, 0, 0], [0, 0.45, 0], [0, 0, 0.02], steel);
        const m = [(a.p[0] + b.p[0]) / 2, (y + y1) / 2 + 0.9, (a.p[1] + b.p[1]) / 2], hv = [(b.p[0] - a.p[0]) / 2, (y1 - y) / 2, (b.p[1] - a.p[1]) / 2];
        const t = [-a.n[1], a.n[0]];
        geo.obox(m, hv, [0, 0.018, 0], [t[0] * 0.018, 0, t[1] * 0.018], steel);
      });
    }
    // seats as thin instances; lite mode leaves the far-away upper tier without seats
    if (lite && ti === 1) { const dE = T.d0 + T.rows * T.D; sweep(geo, path, dE, rowsY[T.rows], dE, rowsY[T.rows] + 6, [0.16, 0.16, 0.18]); T.yTop = rowsY[T.rows]; T.dEnd = dE; continue; }
    const sg = seatGeo(), seat = sg.mesh('seats' + ti, scene, mat(scene, 'seatm' + ti, [1, 1, 1], { spec: 0.25 }));
    seat.unfreezeWorldMatrix();
    const mats = [], cols = [], M = new BABYLON.Matrix(), q = new BABYLON.Quaternion(), one = new BABYLON.Vector3(1, 1, 1), pos = new BABYLON.Vector3();
    for (let i = 0; i < T.rows; i++) {
      const dmid = T.d0 + i * T.D + T.D * 0.5;
      walk(path, dmid, 0.52, aisles, 0.62, (p, n) => {
        BABYLON.Quaternion.RotationYawPitchRollToRef(Math.atan2(-n[0], -n[1]), 0, 0, q);
        pos.set(p[0], rowsY[i], p[1]);
        BABYLON.Matrix.ComposeToRef(one, q, pos, M);
        M.copyToArray(mats, mats.length);
        const v = 0.92 + r() * 0.12;
        cols.push(T.seat[0] * v, T.seat[1] * v, T.seat[2] * v, 1);
      });
    }
    seat.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
    seat.thinInstanceSetBuffer('color', new Float32Array(cols), 4, true);
    seat.alwaysSelectAsActiveMesh = true;
    seatsOut.push(seat); meshes.push(seat);
    // back wall of the tier
    sweep(geo, path, dEnd, rowsY[T.rows], dEnd, rowsY[T.rows] + (ti === 0 ? 0.9 : 6), [0.16, 0.16, 0.18]);
    T.yTop = rowsY[T.rows]; T.dEnd = dEnd;
  }
  const [lo, up] = tiers;
  // padded front wall of the lower bowl
  sweep(geo, path, -0.03, 0, -0.03, lo.y0, [0.05, 0.08, 0.22]);
  sweep(geo, path, -0.03, lo.y0, 0.0, lo.y0, [0.08, 0.1, 0.25]);
  // upper-tier underside (soffit) and its front parapet
  sweep(geo, path, up.d0, up.y0 - 1.0, lo.dEnd + 0.6, up.y0 - 1.0, [0.12, 0.12, 0.14]);
  sweep(geo, path, up.d0, up.y0, up.d0, up.y0 + 0.85, [0.10, 0.11, 0.14]);
  sweep(geo, path, up.d0 - 0.25, up.y0 + 0.85, up.d0, up.y0 + 0.85, [0.2, 0.2, 0.22]);
  // concourse floor between the tiers
  sweep(geo, path, lo.dEnd, lo.yTop, lo.dEnd + 0.6, lo.yTop, [0.22, 0.22, 0.24]);
  meshes.push(geo.mesh('bowl', scene, mat(scene, 'bowlm', [1, 1, 1], { spec: 0.04 })));

  // suite glass under the upper tier, LED ribbon on its fascia
  const sGeo = new Geo();
  sweep(sGeo, path, lo.dEnd + 0.6, lo.yTop + 0.05, lo.dEnd + 0.6, up.y0 - 1.0, [1, 1, 1], 9);
  const suite = sGeo.mesh('suites', scene, mat(scene, 'suitem', [1, 1, 1], { emissive: 1, tex: suiteTexture(scene) }));
  const rGeo = new Geo();
  sweep(rGeo, path, up.d0 - 0.01, up.y0 - 1.0, up.d0 - 0.01, up.y0, [1, 1, 1], 26);
  const ribbon = rGeo.mesh('ribbonboard', scene, mat(scene, 'ribbonm', [1, 1, 1], { emissive: 1, tex: ribbonTexture(scene) }));
  meshes.push(suite, ribbon);
  // exit signs above the lower-bowl aisles
  const eGeo = new Geo();
  for (const a of aislePoints(path, aisles, lo.dEnd - 0.05)) {
    const t = [-a.n[1], a.n[0]];
    eGeo.obox([a.p[0], lo.yTop + 0.75, a.p[1]], [t[0] * 0.2, 0, t[1] * 0.2], [0, 0.08, 0], [a.n[0] * 0.03, 0, a.n[1] * 0.03], [0.1, 0.95, 0.35]);
  }
  meshes.push(eGeo.mesh('exits', scene, mat(scene, 'exitm', [1, 1, 1], { emissive: 1 })));
  for (const m of meshes) m.receiveShadows = false;
  return { meshes, seats: seatsOut, extent: { x: hx + 4.6 + up.dEnd, z: hz + 4.8 + up.dEnd, top: up.yTop } };
}
