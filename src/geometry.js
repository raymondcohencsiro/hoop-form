// Procedural geometry (plain arrays): lathe, capsule profiles, torus, boxes.
// Port of graphics.py. Positions/normals/uvs/indices; triangle winding as in Ursina.
export function lathe(profile, segments = 24, sx = 1, sz = 1) {
  const P = [], N = [], U = [], I = [], n = profile.length;
  for (let i = 0; i < n; i++) {
    const [y, r] = profile[i];
    const [y0, r0] = profile[Math.max(i - 1, 0)], [y1, r1] = profile[Math.min(i + 1, n - 1)];
    const dy = y1 - y0, dr = r1 - r0, ln = Math.hypot(dy, dr) || 1;
    const nr = dy / ln, ny = -dr / ln;
    for (let s = 0; s <= segments; s++) {
      const a = 2 * Math.PI * s / segments, ca = Math.cos(a), sa = Math.sin(a);
      P.push(r * ca * sx, y, r * sa * sz);
      let nx = nr * ca / Math.max(sx, 1e-6), nz = nr * sa / Math.max(sz, 1e-6);
      const l = Math.hypot(nx, ny, nz) || 1;
      N.push(nx / l, ny / l, nz / l);
      U.push(s / segments, i / (n - 1));
    }
  }
  const w = segments + 1;
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < segments; s++) {
    const a = i * w + s, b = a + 1, c = (i + 1) * w + s, d = c + 1;
    I.push(a, b, c, b, d, c);
  }
  return { positions: P, normals: N, uvs: U, indices: I };
}
export function capsuleProfile(length, rTop, rBot, bulge = 0, bulgePos = 0.35, steps = 14) {
  const pts = [], cap = 6;
  for (let k = 0; k <= cap; k++) { const ang = -Math.PI / 2 + (k / cap) * Math.PI / 2; pts.push([-length + rBot * Math.sin(ang), rBot * Math.cos(ang)]); }
  for (let k = 1; k < steps; k++) {
    const u = k / steps, y = -length + u * length, p = 1 - u;
    let r = rBot + (rTop - rBot) * u;
    r *= 1 + bulge * Math.exp(-((p - bulgePos) ** 2) / 0.03);
    pts.push([y, r]);
  }
  for (let k = 0; k <= cap; k++) { const ang = (k / cap) * Math.PI / 2; pts.push([rTop * Math.sin(ang), rTop * Math.cos(ang)]); }
  return pts;
}
export function uvSphere(radius = 0.5, rings = 24, segments = 32) {
  const prof = [];
  for (let i = 0; i <= rings; i++) prof.push([-radius * Math.cos(Math.PI * i / rings), radius * Math.sin(Math.PI * i / rings)]);
  return lathe(prof, segments);
}
export function torus(R, r, segMaj = 48, segMin = 12) {
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= segMaj; i++) {
    const a = 2 * Math.PI * i / segMaj, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= segMin; j++) {
      const b = 2 * Math.PI * j / segMin, cb = Math.cos(b), sb = Math.sin(b);
      P.push((R + r * cb) * ca, r * sb, (R + r * cb) * sa); N.push(cb * ca, sb, cb * sa); U.push(i / segMaj, j / segMin);
    }
  }
  const w = segMin + 1;
  for (let i = 0; i < segMaj; i++) for (let j = 0; j < segMin; j++) {
    const a = i * w + j, b = a + 1, c = (i + 1) * w + j, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
  return { positions: P, normals: N, uvs: U, indices: I };
}
// Accumulates flat-shaded vertex-coloured boxes into one mesh (stands, crowd, props).
export class BoxBuilder {
  constructor() { this.P = []; this.N = []; this.C = []; this.U = []; this.I = []; }
  quad(p0, p1, p2, p3, col, n) {
    const i = this.P.length / 3;
    for (const p of [p0, p1, p2, p3]) { this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.C.push(col[0], col[1], col[2], col[3] ?? 1); }
    this.U.push(0, 0, 1, 0, 1, 1, 0, 1);
    this.I.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  box(c, size, col, yaw = 0, topCol = null) {
    const [cx, cy, cz] = c, hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    const ca = Math.cos(yaw * Math.PI / 180), sa = Math.sin(yaw * Math.PI / 180);
    const P = (x, y, z) => [cx + x * ca + z * sa, cy + y, cz - x * sa + z * ca];
    const R = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
    const tc = topCol || col;
    this.quad(P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), tc, R(0, 1, 0));
    this.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), col, R(0, -1, 0));
    this.quad(P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), P(-hx, -hy, hz), col, R(0, 0, 1));
    this.quad(P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, -hy, -hz), col, R(0, 0, -1));
    this.quad(P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), col, R(1, 0, 0));
    this.quad(P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), P(-hx, -hy, -hz), col, R(-1, 0, 0));
  }
  build() { return { positions: this.P, normals: this.N, colors: this.C, uvs: this.U, indices: this.I }; }
}
