// Basketball net as a little cloth: knots joined by cords, hung from the 12 ring hooks.
// Verlet integration with distance constraints (rings, verticals and the diamond diagonals),
// gravity and damping; the ball pushes the knots out of its way and drags them along a little.
// Coordinates are local to the ring centre (y up). The ball is driven by its own (precomputed)
// flight, so the coupling is one way: the net reacts to the ball.

const RING_K = 0.25, CORD_K = 0.85, DRAG = 0.01, SHAPE = 0.005;   // ring / cord stiffness (per iteration), motion left after 1 s, pull back to the hanging shape (per substep)

export class NetSim {
  constructor({ rTop, rBottom, length, rows = 9, cols = 24, hookY = -0.012 }) {
    this.rows = rows; this.cols = cols; this.n = rows * cols;
    this.P = new Float32Array(this.n * 3); this.Q = new Float32Array(this.n * 3); this.R = new Float32Array(this.n * 3);
    for (let i = 0; i < rows; i++) {
      const v = i / (rows - 1), r = rTop + (rBottom - rTop) * Math.pow(v, 0.85), y = hookY - v * length;
      for (let j = 0; j < cols; j++) {
        const a = 2 * Math.PI * (j + (i % 2) * 0.5) / cols, k = 3 * (i * cols + j);
        this.R[k] = Math.cos(a) * r; this.R[k + 1] = y; this.R[k + 2] = Math.sin(a) * r;
      }
    }
    // constraints [a, b, rest]: around each row, down each column, and both diagonals (the diamond cords)
    const C = [], id = (i, j) => i * cols + ((j % cols) + cols) % cols, L = (a, b) => Math.hypot(this.R[3 * a] - this.R[3 * b], this.R[3 * a + 1] - this.R[3 * b + 1], this.R[3 * a + 2] - this.R[3 * b + 2]);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = id(i, j);
      if (i > 0) C.push([a, id(i, j + 1), RING_K]);                                       // rows: soft and stretchy (the bottom opening widens round the ball)
      if (i < rows - 1) {
        const off = i % 2;                                                                  // odd rows sit half a mesh round
        for (const dj of [off - 1, off]) C.push([a, id(i + 1, j + dj), CORD_K]);            // the two diamond cords below each knot (a little elastic)
      }
    }
    this.C = C.map(([a, b, s]) => [a, b, L(a, b), s]);
    this.reset();
  }
  reset() { this.P.set(this.R); this.Q.set(this.R); this.ball = null; this.time = 0; this.idle = false; }
  /** advance by dt seconds; ball = {x,y,z} in ring-local coords (or null), r = ball radius */
  step(dt, ball, r) {
    if (!(dt > 0)) return;
    if (dt > 0.25) { this.reset(); return; }                                                 // a jump in time (seek): start from rest
    const sub = Math.max(1, Math.ceil(dt / (1 / 300))), h = dt / sub, g = -9.81 * h * h, damp = Math.pow(DRAG, h);   // air drag on the cords
    const prev = this.ball;
    for (let s = 1; s <= sub; s++) {
      const P = this.P, Q = this.Q, cols = this.cols;
      for (let k = 3 * cols; k < P.length; k += 3) {                                        // top row is tied to the hooks
        const x = P[k], y = P[k + 1], z = P[k + 2];
        P[k] += (x - Q[k]) * damp; P[k + 1] += (y - Q[k + 1]) * damp + g; P[k + 2] += (z - Q[k + 2]) * damp;
        Q[k] = x; Q[k + 1] = y; Q[k + 2] = z;
      }
      for (let k = 3 * cols; k < P.length; k++) P[k] += (this.R[k] - P[k]) * SHAPE;       // the knotted net 'remembers' its shape
      let b = null, db = null;
      if (ball) {
        const u = s / sub;
        b = prev ? [prev.x + (ball.x - prev.x) * u, prev.y + (ball.y - prev.y) * u, prev.z + (ball.z - prev.z) * u] : [ball.x, ball.y, ball.z];
        db = prev ? [(ball.x - prev.x) / sub, (ball.y - prev.y) / sub, (ball.z - prev.z) / sub] : [0, 0, 0];
      }
      for (let it = 0; it < 6; it++) {
        for (const [a, c, rest, st] of this.C) {
          const ia = 3 * a, ic = 3 * c, dx = P[ic] - P[ia], dy = P[ic + 1] - P[ia + 1], dz = P[ic + 2] - P[ia + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-9;
          if (d < rest * 0.6) { /* allow bunching */ } else if (d < rest && st >= CORD_K) continue;   // cords go slack, they don't push
          const corr = (d - rest) / d * 0.5 * st, wa = a < cols ? 0 : 1, wc = c < cols ? 0 : 1, wsum = wa + wc;
          if (!wsum) continue;
          const fa = corr * 2 * wa / wsum, fc = corr * 2 * wc / wsum;
          P[ia] += dx * fa; P[ia + 1] += dy * fa; P[ia + 2] += dz * fa;
          P[ic] -= dx * fc; P[ic + 1] -= dy * fc; P[ic + 2] -= dz * fc;
        }
        if (b) {                                                                             // ball: push knots to its surface, drag them along
          const rr = r + 0.005;
          for (let k = 3 * cols; k < P.length; k += 3) {
            const dx = P[k] - b[0], dy = P[k + 1] - b[1], dz = P[k + 2] - b[2], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-9, nx = dx / d, ny = dy / d, nz = dz / d, push = rr - d;
            P[k] += nx * push; P[k + 1] += ny * push; P[k + 2] += nz * push;
            // contact without kicking the knot: its velocity becomes the ball's along the normal (if the
            // ball is moving into it) and is partly carried along the surface by friction
            const vx = P[k] - Q[k], vy = P[k + 1] - Q[k + 1], vz = P[k + 2] - Q[k + 2], mu = 0.35;
            const vn = vx * nx + vy * ny + vz * nz, bn = db[0] * nx + db[1] * ny + db[2] * nz, n2 = Math.max(bn, Math.min(vn, 0));
            const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz, btx = db[0] - bn * nx, bty = db[1] - bn * ny, btz = db[2] - bn * nz;
            Q[k] = P[k] - (n2 * nx + tx * (1 - mu) + btx * mu);
            Q[k + 1] = P[k + 1] - (n2 * ny + ty * (1 - mu) + bty * mu);
            Q[k + 2] = P[k + 2] - (n2 * nz + tz * (1 - mu) + btz * mu);
          }
        }
      }
    }
    this.ball = ball ? { ...ball } : null;
  }
}
