// Procedural locomotion (running skills): pelvis speed/height profiles,
// footprints with heel-to-toe roll, ballistic flight and two-bone leg IK.
// A direct port of gait.py; the spec comes from skills.json.
import { V3, DEG } from './math.js';
import { GRAVITY } from './config.js';

export const NOMINAL_HIP_H = 0.530 * 1.60;
export const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
function hermite(t, t0, t1, y0, v0, y1, v1) {
  const h = t1 - t0, u = h > 0 ? (t - t0) / h : 1, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * v0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * v1;
}

export class Gait {
  constructor(specIn, avatar, origin, headingDeg, mirror = false) {
    const spec = JSON.parse(JSON.stringify(specIn));   // contacts get annotated
    this.spec = spec;
    const L = avatar.L;
    this.a = L.thigh; this.b = L.shank; this.ankle_h = L.ankle_h;
    this.ball_off = L.foot * 1.04 * 0.52; this.toe_off = L.foot * 1.04 * 0.76; this.heel_off = L.foot * 1.04 * 0.22;
    this.hip_x = L.hip_x; this.hip_h = L.hip_h;
    this.k = this.hip_h / NOMINAL_HIP_H;
    this.mx = mirror ? -1 : 1;
    this.side_name = { S: mirror ? 'L' : 'R', G: mirror ? 'R' : 'L' };
    const hd = headingDeg * DEG;
    this.fwd = new V3(Math.sin(hd), 0, Math.cos(hd));
    this.right = new V3(Math.cos(hd), 0, -Math.sin(hd));
    this.origin = new V3(origin.x, 0, origin.z);
    const sp = spec.speed;
    this.t_min = sp[0][0]; this.t_max = sp[sp.length - 1][0]; this.dt = 0.002;
    const n = Math.floor((this.t_max - this.t_min) / this.dt) + 2;
    this._s = new Float64Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) { s += this._v(this.t_min + (i - 0.5) * this.dt) * this.dt; this._s[i] = s; }
    this._s0 = this._interpS(0);
    for (const c of spec.contacts) {
      const tm = 0.5 * (c.t0 + c.t1);
      c.s = this.s(tm) + c.ahead * this.k;
      c.world = this._world(c.s, c.side * this.k);
    }
    this.by_foot = {};
    for (const f of ['S', 'G']) this.by_foot[f] = spec.contacts.filter((c) => c.foot === f).sort((a, b) => a.t0 - b.t0);
  }
  _v(t) {
    const sp = this.spec.speed;
    if (t <= sp[0][0]) return sp[0][1];
    for (let i = 0; i < sp.length - 1; i++) {
      const [t0, v0] = sp[i], [t1, v1] = sp[i + 1];
      if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
    }
    return sp[sp.length - 1][1];
  }
  _interpS(t) {
    const f = (t - this.t_min) / this.dt;
    const i = Math.max(0, Math.min(Math.floor(f), this._s.length - 2));
    const u = f - i;
    return this._s[i] + (this._s[i + 1] - this._s[i]) * u;
  }
  s(t) { return (this._interpS(t) - this._s0) * this.k; }
  speed(t) { return this._v(t) * this.k; }
  y(t) { return this._yNominal(t) * this.k; }
  _yNominal(t) {
    for (const [ta, tb] of this.spec.flights) {
      if (ta <= t && t <= tb) {
        const [y0, v0] = this._knot(ta), tau = t - ta;
        return y0 + v0 * tau - 0.5 * GRAVITY * tau * tau;
      }
    }
    const kn = this.spec.height;
    if (t <= kn[0][0]) return kn[0][1];
    for (let i = 0; i < kn.length - 1; i++) {
      const [t0, y0, v0] = kn[i], [t1, y1, v1] = kn[i + 1];
      if (t <= t1) return hermite(t, t0, t1, y0, v0, y1, v1);
    }
    return kn[kn.length - 1][1];
  }
  _knot(t) {
    for (const k of this.spec.height) if (Math.abs(k[0] - t) < 1e-9) return [k[1], k[2]];
    throw new Error('no knot at ' + t);
  }
  _world(s, d) { return this.origin.add(this.fwd.mul(s)).add(this.right.mul(d * this.mx)); }
  pelvis(t) { const p = this._world(this.s(t), 0); return new V3(p.x, this.y(t), p.z); }
  root(t) { const p = this.pelvis(t); return new V3(p.x, p.y - this.hip_h, p.z); }

  _stancePitch(c, u) {
    const dur = c.t1 - c.t0;
    const on = Math.min(0.2 * dur, 0.06) / dur, off = Math.min(0.5 * dur, 0.12) / dur;
    if (u < on) return c.pitch_on * (1 - smooth(u / on));
    if (u < 1 - off) return 0;
    return c.pitch_off * smooth((u - (1 - off)) / off);
  }
  _ankleFromBall(ball, pitch) {
    const p = pitch * DEG;
    let piv, off;
    if (pitch >= 0) { piv = ball.add(this.fwd.mul(this.toe_off - this.ball_off)); off = -this.toe_off; }
    else { piv = ball.sub(this.fwd.mul(this.ball_off + this.heel_off)); off = this.heel_off; }
    const up = this.ankle_h * Math.cos(p) - off * Math.sin(p);
    const fw = off * Math.cos(p) + this.ankle_h * Math.sin(p);
    return piv.add(this.fwd.mul(fw)).add(new V3(0, up, 0));
  }
  foot(f, t) {
    const cs = this.by_foot[f], ramp = this.spec.key_ramp;
    for (const c of cs) {
      if (c.t0 <= t && t <= c.t1) return [c.world, this._stancePitch(c, (t - c.t0) / (c.t1 - c.t0)), 1];
    }
    for (let i = 0; i < cs.length - 1; i++) {
      const c0 = cs[i], c1 = cs[i + 1];
      if (c0.t1 < t && t < c1.t0) {
        if (c1.from_air) break;
        // running swing: the heel kicks up behind first (peak ~40% of the swing, higher the
        // faster you run), then the knee carries the foot through and it reaches down to land
        const u = (t - c0.t1) / (c1.t0 - c0.t1), k = smooth(Math.pow(u, 1.25));
        const dist = c1.world.sub(c0.world).len(), kick = Math.min(1.9, Math.max(1, dist / (0.55 * this.k)));
        let ball = c0.world.lerp(c1.world, k);
        ball = new V3(ball.x, c1.lift * kick * this.k * Math.sin(Math.PI * Math.pow(u, 0.75)), ball.z);
        const bump = 25 * (kick - 1) * Math.sin(Math.PI * u);                     // toes point down through the kick
        return [ball, c0.pitch_off + (c1.pitch_on - c0.pitch_off) * k + bump, 1];
      }
    }
    const prev = cs.filter((c) => c.t1 <= t), nxt = cs.filter((c) => c.t0 >= t);
    if (prev.length && t - prev[prev.length - 1].t1 < ramp) {
      const c = prev[prev.length - 1], dt = t - c.t1, w = 1 - smooth(dt / ramp);
      return [c.world.add(this.fwd.mul(dt * 1.5)).add(new V3(0, dt * 1.2, 0)), c.pitch_off, w];
    }
    if (nxt.length && nxt[0].t0 - t < ramp) {
      const c = nxt[0], dt = c.t0 - t, w = 1 - smooth(dt / ramp);
      return [c.world.sub(this.fwd.mul(dt * 0.6)).add(new V3(0, dt * 1.4, 0)), c.pitch_on, w];
    }
    return null;
  }
  legAngles(f, t, hipW, keyHip, keyKnee, keyToes) {
    const st = this.foot(f, t);
    if (!st) return null;
    let [ball, pitch, w] = st;
    const reach = this.a + this.b - 1e-4;
    let ankle = this._ankleFromBall(ball, pitch);
    while (ankle.sub(hipW).len() > reach && pitch < 75) { pitch += 2; ankle = this._ankleFromBall(ball, pitch); }
    const d = ankle.sub(hipW);
    const lx = d.dot(this.right), ly = d.y, lz = d.dot(this.fwd);
    const Lh = Math.min(Math.max(d.len(), 0.25), reach);
    const rz = -Math.asin(Math.max(-1, Math.min(1, lx / Lh))) / DEG;
    const down = Math.sqrt(Math.max(lx * lx + ly * ly, 1e-9)) * (ly < 0 ? 1 : -1);
    const phi = Math.atan2(lz, down);
    const a = this.a, b = this.b;
    const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + Lh * Lh - b * b) / (2 * a * Lh))));
    const inner = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - Lh * Lh) / (2 * a * b))));
    const hipRx = -(phi + alpha) / DEG, kneeRx = 180 - inner / DEG;
    if (w >= 1) return [[hipRx, rz], kneeRx, pitch];
    return [[keyHip[0] + (hipRx - keyHip[0]) * w, keyHip[2] + (rz - keyHip[2]) * w],
            keyKnee[0] + (kneeRx - keyKnee[0]) * w, keyToes + (pitch - keyToes) * w];
  }
  applyToPose(t, pose, yaw) {
    const root = this.root(t), y = yaw * DEG;
    const right = new V3(Math.cos(y), 0, -Math.sin(y));
    const pel = new V3(root.x, root.y + this.hip_h, root.z);
    for (const f of ['S', 'G']) {
      const side = this.side_name[f], sx = side === 'R' ? 1 : -1;
      const hipW = pel.add(right.mul(sx * this.hip_x));
      const res = this.legAngles(f, t, hipW, pose[`hip_${side}`] ?? [0, 0, 0], pose[`knee_${side}`] ?? [0, 0, 0],
                                 pose[`toes_${side}`] ?? 0);
      if (!res) continue;
      const [[hrx, hrz], krx, toes] = res;
      pose[`hip_${side}`] = [hrx, 0, hrz]; pose[`knee_${side}`] = [krx, 0, 0]; pose[`toes_${side}`] = toes;
    }
    return root;
  }
}
