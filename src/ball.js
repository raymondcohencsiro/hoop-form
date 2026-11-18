// Ball flight: launch-speed solver, bank-shot solver and a deterministic
// simulation (backspin, glass bounce, swish, net drag, floor bounces) that
// can be scrubbed. Port of ball.py (physics only).
import { V3, DEG } from './math.js';
import { GRAVITY, NET_LENGTH } from './config.js';

export class BallPhysics {
  constructor(radius) {
    this.r = radius; this.DT = 1 / 240; this.BOARD_E = 0.55; this.BOARD_F = 0.85;
    this.samples = []; this.released = false; this.t_through = null; this.entry_angle = null;
    this.release_angle = null; this.release_elbow = null; this.bank_point = null; this.t_bank = null;
    this.dir = new V3(0, 0, 1);
  }
  static launchVelocity(p0, target, angleDeg) {
    const d = new V3(target.x - p0.x, 0, target.z - p0.z), D = d.len(), dy = target.y - p0.y, th = angleDeg * DEG;
    const denom = 2 * Math.cos(th) ** 2 * (D * Math.tan(th) - dy);
    const v = denom > 0 ? Math.sqrt(GRAVITY * D * D / denom) : 8;
    const dh = D > 0 ? d.mul(1 / D) : new V3(0, 0, 1);
    return dh.mul(v * Math.cos(th)).add(new V3(0, v * Math.sin(th), 0));
  }
  solveBank(p0, angle, rim, boardZ, side = 1, aimHeight = null) {
    if (aimHeight == null) return this._bankAt(p0, angle, rim, boardZ, side);
    const want = rim.y + aimHeight;
    let a0 = angle, a1 = angle + 3;
    this._bankAt(p0, a0, rim, boardZ, side);
    let f0 = this.bank_point.y - want;
    for (let i = 0; i < 25; i++) {
      this._bankAt(p0, a1, rim, boardZ, side);
      const f1 = this.bank_point.y - want;
      if (Math.abs(f1) < 0.002 || Math.abs(f1 - f0) < 1e-9) break;
      const a2 = Math.max(35, Math.min(80, a1 - f1 * (a1 - a0) / (f1 - f0)));
      a0 = a1; a1 = a2; f0 = f1;
    }
    this.bank_angle = a1;
    return this._bankAt(p0, a1, rim, boardZ, side);
  }
  _bankAt(p0, angle, rim, boardZ, side) {
    const g = GRAVITY, e = this.BOARD_E, f = this.BOARD_F, zc = boardZ - this.r, rimY = rim.y;
    const miss = (bx, by) => {
      const B = new V3(bx, by, zc), v = BallPhysics.launchVelocity(p0, B, angle);
      const vh = Math.hypot(v.x, v.z), T = Math.hypot(B.x - p0.x, B.z - p0.z) / Math.max(vh, 1e-6);
      const vy = (v.y - g * T) * f, vx = v.x * f, vz = -v.z * e;
      const disc = vy * vy + 2 * g * (by - rimY);
      if (disc < 0) return [1, 1];
      const t = (vy + Math.sqrt(disc)) / g;
      return [bx + vx * t - rim.x, zc + vz * t - rim.z];
    };
    let bx = rim.x + side * 0.12, by = rimY + 0.35;
    for (let i = 0; i < 30; i++) {
      const [ex, ez] = miss(bx, by);
      if (Math.hypot(ex, ez) < 1e-4) break;
      const h = 1e-3, [a, c] = miss(bx + h, by), [b, d] = miss(bx, by + h);
      const j11 = (a - ex) / h, j21 = (c - ez) / h, j12 = (b - ex) / h, j22 = (d - ez) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) break;
      bx -= Math.max(-0.2, Math.min(0.2, (j22 * ex - j12 * ez) / det));
      by -= Math.max(-0.2, Math.min(0.2, (-j21 * ex + j11 * ez) / det));
    }
    const aim = new V3(bx, by, zc);
    this.bank_point = new V3(bx, by, boardZ);
    return [aim, BallPhysics.launchVelocity(p0, aim, angle)];
  }
  computeFlight(p0, target, angle, spinRps, rim, bank = null, floorY = 0) {
    const g = GRAVITY, DT = this.DT;
    this.bank_point = null;
    let vel;
    if (bank) [target, vel] = this.solveBank(p0, angle, rim, bank.board_z, bank.side ?? 1, bank.aim_height);
    else vel = BallPhysics.launchVelocity(p0, target, angle);
    const dh = new V3(vel.x, 0, vel.z);
    this.dir = dh.len() > 1e-6 ? dh.norm() : new V3(0, 0, 1);
    this.launch_speed = vel.len(); this.v0 = vel.clone();
    this.release_angle = Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) / DEG;
    let pos = p0.clone(), spin = 0, spinRate = -360 * spinRps;
    const rimY = rim.y, samples = [];
    let t = 0, bounces = 0, rolling = false;
    this.t_through = null; this.entry_angle = null; this.t_bank = null;
    const boardZc = bank ? bank.board_z - this.r : null;
    while (t < 4.5) {
      samples.push([pos.clone(), spin]);
      const prevY = pos.y;
      vel = vel.add(new V3(0, -g * DT, 0));
      if (boardZc != null && this.t_bank == null && pos.z >= boardZc && vel.z > 0) {
        pos = new V3(pos.x, pos.y, boardZc);
        vel = new V3(vel.x * this.BOARD_F, vel.y * this.BOARD_F, -vel.z * this.BOARD_E);
        this.t_bank = t;
      }
      const inNet = rimY - NET_LENGTH - 0.05 < pos.y && pos.y < rimY + 0.02 && this.t_through != null;
      if (inNet) {
        const k = Math.exp(-7 * DT);
        vel = new V3(vel.x * k, vel.y * Math.exp(-2.5 * DT), vel.z * k);
        pos = pos.add(new V3(rim.x, pos.y, rim.z).sub(pos).mul(8 * DT));
      }
      pos = pos.add(vel.mul(DT));
      if (this.t_through == null && prevY >= rimY && rimY > pos.y && vel.y < 0) {
        this.t_through = t;
        this.entry_angle = Math.atan2(-vel.y, Math.hypot(vel.x, vel.z)) / DEG;
        this.entry_pos = new V3(pos.x, rimY, pos.z); this.entry_vel = vel.clone();     // for the shot readout
      }
      if (pos.y < floorY + this.r) {
        pos.y = floorY + this.r;
        if (Math.abs(vel.y) > 0.6 && bounces < 8) { vel = new V3(vel.x * 0.85, -vel.y * 0.72, vel.z * 0.85); bounces++; }
        else { vel = new V3(vel.x * (1 - 1.5 * DT), 0, vel.z * (1 - 1.5 * DT)); rolling = true; }
        spinRate = Math.hypot(vel.x, vel.z) / this.r / DEG;
      }
      if (rolling) spinRate = Math.hypot(vel.x, vel.z) / this.r / DEG;
      spin += spinRate * DT;
      t += DT;
    }
    this.samples = samples; this.flight_duration = t;
    this.p0 = p0.clone();
    { let k = 0; samples.forEach((sm, i) => { if (sm[0].y > samples[k][0].y) k = i; }); this.apex_pos = samples[k][0].clone(); }                                                          // release point
    this.apex_y = samples.reduce((m, sm) => Math.max(m, sm[0].y), p0.y);   // highest point of the flight (camera framing)
  }
  sample(t) {
    const f = Math.max(0, t) / this.DT, i = Math.floor(f);
    if (i >= this.samples.length - 1) return this.samples[this.samples.length - 1];
    const a = this.samples[i], b = this.samples[i + 1], u = f - i;
    return [a[0].lerp(b[0], u), a[1] + (b[1] - a[1]) * u];
  }
}
