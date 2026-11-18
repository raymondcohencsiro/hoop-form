// Coaching orbit camera (presets + auto-fit) and the first-person trainer.
// Port of camera_rig.py. Angles in degrees, Ursina/Babylon conventions:
// yaw about +Y (0 = looking down +Z), pitch positive = looking down.
import { V3, DEG } from './math.js';
import * as C from './config.js';

// name: [yaw, pitch, distance, target height (x player scale), fraction toward rim, vertical fov of the free area]
export const PRESETS = {
  coach: [-140, 7, 4.4, 1.00, 0.00, 45],
  hands: [-105, 12, 2.2, 1.05, 0.00, 42],
  side: [-90, 4, 4.3, 0.95, 0.00, 45],
  side_close: [-90, 3, 3.0, 1.42, 0.03, 45],
  front: [180, 5, 4.0, 1.05, 0.00, 45],
  behind: [-14, 4, 4.4, 1.35, 0.12, 55],
  wide: [-98, 6, 11.5, 2.30, 0.52, 50],
  shot: [-90, 3, 8, 1.5, 0.5, 42],     // whole shot: worked out each frame in goalFor (player, arc and backboard)
};
// the four camera modes the app offers (the presets above are what Auto picks from per phase)
export const CAM_MODES = ['auto', 'third', 'first', 'coach'];
export const CAM_LABELS = { auto: 'Auto', third: 'Third person', first: 'First person', coach: 'Coach view' };
export const ORDER = ['coach', 'side', 'front', 'behind', 'hands', 'side_close', 'wide'];
export const LABELS = { coach: 'Coach', side: 'Side', front: 'Front', behind: 'Behind', hands: 'Hands', side_close: 'Side close', wide: 'Wide', shot: 'Over the shoulder' };
const ABSOLUTE = new Set(['wide']);
const FIT_MARGIN = 0.045, FIT_FOV_MAX = 68;
const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;

export function forward(yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  return new V3(Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p));
}

export class OrbitCam {
  constructor() {
    this.mirror = false; this.scale = 1; this.heading = 0; this.dist_scale = 1; this.fov_offset = 0;
    this.yaw = -140; this.pitch = 7; this.dist = 4.4; this.fov = 45;
    this.target = new V3(0, 1, 0); this.toff = new V3(); this.fit = {};
    this.preset = 'coach'; this.user_override = false; this._instant = true; this._last = null;
  }
  goalFor(name, focus, rim, fitOverride) {
    if (name === 'shot' && this.shot) return this.shotGoal(focus, rim);
    let [yaw, pitch, dist, th, frac, fov] = PRESETS[name];
    if (this.mirror && yaw !== 0 && yaw !== 180) yaw = -yaw;
    const fit = fitOverride !== undefined ? fitOverride : this.fit[name];
    if (fit) { fov = fit[0]; dist *= fit[1]; }
    if (!ABSOLUTE.has(name)) yaw += this.heading;
    dist *= this.dist_scale;
    const flat = new V3(focus.x, 0, focus.z), t0 = focus.add(new V3(rim.x, 0, rim.z).sub(flat).mul(frac));
    const tgt = new V3(t0.x, th * this.scale, t0.z);
    dist *= 0.85 + 0.15 * this.scale;
    // keep the camera in front of the backboards (mirror to the court side)
    const cz = tgt.z - Math.cos(yaw * DEG) * Math.cos(pitch * DEG) * dist;
    if (Math.abs(cz) > 13.4) yaw = 180 - yaw;
    return { yaw, pitch, dist, tgt, fov };
  }
  /**
   * The shot from over the shooting shoulder: the camera swings round behind the release point at
   * about the usual coaching distance and aims so the release (hand), the arc and the ring +
   * backboard all fit. Only if they can't fit in a sensible field of view does it ease back a little.
   */
  shotGoal(focus, rim) {
    const sh = this.shot, p0 = sh.p0 || focus.add(new V3(0, 2 * this.scale, 0));
    const flat = new V3(p0.x, 0, p0.z), toRim = new V3(rim.x, 0, rim.z).sub(flat);
    const u = toRim.len() > 1e-3 ? toRim.norm() : new V3(Math.sin(this.heading * DEG), 0, Math.cos(this.heading * DEG));
    const side = new V3(u.z, 0, -u.x).mul(this.mirror ? -1 : 1);                 // toward the shooting hand
    const back = 22 * DEG, boardZ = rim.z + Math.sign(rim.z || 1) * 0.375;      // camera this far round toward the shooting side
    const pts = [p0, p0.add(new V3(0, -0.7 * this.scale, 0)), rim,                     // hand and the head/shoulders under it new V3(rim.x - 0.9, rim.y + 0.75, boardZ), new V3(rim.x + 0.9, rim.y + 0.75, boardZ),
      new V3(rim.x, rim.y - 0.3, boardZ)];
    if (sh.apexY != null) pts.push(new V3((p0.x + rim.x) / 2, sh.apexY + 0.15, (p0.z + rim.z) / 2));
    const base = Math.atan2(u.x, u.z), aspect = Math.max(0.3, this.aspect || 1.6), FMAX = 62;
    let D = 3.4 * (0.85 + 0.15 * this.scale) * this.dist_scale, best = null;
    for (let it = 0; it < 6; it++) {
      const cam = p0.sub(u.mul(D * Math.cos(back))).add(side.mul(D * Math.sin(back)));
      cam.y = p0.y + 0.25 * this.scale;
      let y0 = 1e9, y1 = -1e9, q0 = 1e9, q1 = -1e9;
      for (const p of pts) {
        const d = p.sub(cam), yw = wrap(Math.atan2(d.x, d.z) / DEG - base / DEG), pt = -Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG;
        y0 = Math.min(y0, yw); y1 = Math.max(y1, yw); q0 = Math.min(q0, pt); q1 = Math.max(q1, pt);
      }
      const vNeed = (q1 - q0) * 1.25 + 6, hNeed = (y1 - y0) * 1.2 + 6;
      const vFromH = 2 * Math.atan(Math.tan(hNeed * DEG / 2) / aspect) / DEG;
      const fov = Math.max(38, vNeed, vFromH);
      best = { cam, yaw: base / DEG + (y0 + y1) / 2, pitch: (q0 + q1) / 2, fov };
      if (fov <= FMAX) break;
      D *= 1.15;                                                                 // can't fit: ease back a little
    }
    const f = forward(best.yaw, best.pitch), dist = p0.sub(best.cam).len();       // orbit about a point near the hand
    return { yaw: best.yaw, pitch: best.pitch, dist, tgt: best.cam.add(f.mul(dist)), fov: Math.min(best.fov, 75) };
  }
  setPreset(name, instant = false) { this.preset = name; this.user_override = false; this._instant = instant; }
  update(dt, focus, rim) {
    const g = this.goalFor(this.preset, focus, rim);
    const inst = this._instant, k = inst ? 1 : 1 - Math.exp(-dt * 3);
    this._instant = false;
    if (!this.user_override) {
      this.yaw += wrap(g.yaw - this.yaw) * k;
      this.pitch += (g.pitch - this.pitch) * k;
      this.dist += (g.dist - this.dist) * k;
      this.fov += (g.fov - this.fov) * k;
    }
    // the look-at point always follows the player (also after the user turns or zooms the view),
    // so a moving player such as the layup stays centred; a preset change glides over
    if (!this._last || inst) this.toff = new V3();
    else if (this._last !== this.preset) this.toff = this.target.sub(g.tgt);
    this.toff = this.toff.mul(1 - k);
    this.target = g.tgt.add(this.toff);
    this._last = this.preset;
    this.pitch = Math.max(-10, Math.min(70, this.pitch));
    this.dist = Math.max(0.8, Math.min(30, this.dist));
  }
  orbit(dyaw, dpitch) { this.user_override = true; this.yaw += dyaw; this.pitch += dpitch; }
  zoom(f) { this.user_override = true; this.dist *= f; }
  pose() {
    const f = forward(this.yaw, this.pitch);
    return { pos: this.target.sub(f.mul(this.dist)), yaw: this.yaw, pitch: this.pitch,
      vfov: Math.max(15, Math.min(110, this.fov + this.fov_offset)) };
  }
  /** samples: [{focus, pts:[V3]}]; freeAspect = width/height of the free screen area. */
  fitPresets(samples, rim, freeAspect) {
    const out = {};
    const fits = (name, fov, dmul) => {
      const ty = Math.tan(fov * DEG / 2) * (1 - 2 * FIT_MARGIN), tx = ty * freeAspect;
      for (const s of samples) {
        const g = this.goalFor(name, s.focus, rim, [fov, dmul]);
        const f = forward(g.yaw, g.pitch), y = g.yaw * DEG, right = new V3(Math.cos(y), 0, -Math.sin(y)), up = f.cross(right);
        const pos = g.tgt.sub(f.mul(g.dist));
        for (const P of s.pts) {
          const d = P.sub(pos), z = d.dot(f);
          if (z <= 0.05) return false;
          if (Math.abs(d.dot(right) / z) > tx || Math.abs(d.dot(up) / z) > ty) return false;
        }
      }
      return true;
    };
    for (const name of ORDER) {
      const base = PRESETS[name][5];
      if (fits(name, base, 1)) { out[name] = [base, 1]; continue; }
      if (fits(name, FIT_FOV_MAX, 1)) {
        let lo = base, hi = FIT_FOV_MAX;
        for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (fits(name, m, 1)) hi = m; else lo = m; }
        out[name] = [hi, 1]; continue;
      }
      let lo = 1, hi = 1.5;
      while (!fits(name, FIT_FOV_MAX, hi) && hi < 6) { lo = hi; hi *= 1.5; }
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (fits(name, FIT_FOV_MAX, m)) hi = m; else lo = m; }
      out[name] = [FIT_FOV_MAX, hi];
    }
    this.fit = out;
    return out;
  }
}

export class TrainerCam {
  constructor() {
    this.EYE = 1.5; this.RUN = 5; this.WALK = 1.5; this.CROUCH_SPEED = 1.2; this.CROUCH_FACTOR = 0.62;
    this.JUMP_HEIGHT = 0.45; this.FLY = 6; this.SENS = 0.12; this.INVERT_Y = true;
    this.FOV_DEFAULT = 90; this.FOV_MIN = 30; this.FOV_MAX = 120;
    this.active = false; this.noclip = false; this.fov = 90;
    this.pos = new V3(-10.2, this.EYE, 5.5); this.yaw = 125; this.pitch = 4;
    this.bob = 0; this.air = 0; this.vy = 0; this.crouch = 0; this.visited = false; this.eyeY = this.EYE;
  }
  setEyeHeight(h) { this.EYE = h; if (!this.noclip) this.pos = new V3(this.pos.x, h, this.pos.z); }
  get grounded() { return this.air <= 0 && this.vy <= 0; }
  jump() { if (this.noclip || !this.grounded) return false; this.vy = Math.sqrt(2 * 9.81 * this.JUMP_HEIGHT); return true; }
  enter(face) {
    if (face && !this.visited) { this.yaw = Math.atan2(face.x - this.pos.x, face.z - this.pos.z) / DEG; this.visited = true; }
    this.active = true;
  }
  look(dx, dy, sens = this.SENS) {
    this.yaw += dx * sens;
    this.pitch += (this.INVERT_Y ? -dy : dy) * sens;
    this.pitch = Math.max(-85, Math.min(85, this.pitch));
  }
  changeFov(dir) { this.fov = Math.max(this.FOV_MIN, Math.min(this.FOV_MAX, this.fov + dir * 5)); }
  toggleNoclip(player, obstacles) {
    this.noclip = !this.noclip;
    if (!this.noclip) this.pos = this.constrain(new V3(this.pos.x, this.EYE, this.pos.z), player, obstacles);
    return this.noclip;
  }
  constrain(p, player, obstacles) {
    let x = Math.max(-11, Math.min(11, p.x)), z = Math.max(-18, Math.min(18, p.z));
    const list = [...obstacles, ...(player ? [[player, 1.0]] : [])];
    for (const [c, r] of list) {
      let ox = x - c.x, oz = z - c.z; const d = Math.hypot(ox, oz);
      if (d < r) { if (d > 1e-6) { ox /= d; oz /= d; } else { ox = 1; oz = 0; } x = c.x + ox * r; z = c.z + oz * r; }
    }
    return new V3(x, p.y, z);
  }
  /** inp: {fb, lr, slow, crouch, up, down} with fb/lr in -1..1 (analog from the touch stick) */
  update(dt, inp, player, obstacles) {
    const y = this.yaw * DEG, pr = this.pitch * DEG, right = new V3(Math.cos(y), 0, -Math.sin(y));
    let bob = 0;
    if (this.noclip) {
      const f = forward(this.yaw, this.pitch);
      const d = f.mul(inp.fb).add(right.mul(inp.lr)).add(new V3(0, (inp.up ? 1 : 0) - (inp.down ? 1 : 0), 0));
      const L = d.len();
      if (L > 0) this.pos = this.pos.add(d.mul(Math.min(1, L) / L * this.FLY * (inp.slow ? 0.3 : 1) * dt));
      this.eyeY = this.pos.y;
    } else {
      this.crouch += ((inp.crouch ? 1 : 0) - this.crouch) * (1 - Math.exp(-dt * 12));
      if (this.vy !== 0 || this.air > 0) { this.vy -= 9.81 * dt; this.air += this.vy * dt; if (this.air <= 0) { this.air = 0; this.vy = 0; } }
      const f = new V3(Math.sin(y), 0, Math.cos(y)), d = f.mul(inp.fb).add(right.mul(inp.lr)), L = d.len();
      if (L > 0.05) {
        const crouching = this.crouch > 0.5, speed = crouching ? this.CROUCH_SPEED : (inp.slow ? this.WALK : this.RUN);
        this.pos = this.constrain(this.pos.add(d.mul(Math.min(1, L) / L * speed * dt)), player, obstacles);
        if (this.grounded) { this.bob += dt * (inp.slow || crouching ? 7 : 12) * Math.min(1, L); bob = (inp.slow || crouching ? 0.02 : 0.035) * Math.sin(this.bob); }
      }
      this.eyeY = this.EYE * (1 - (1 - this.CROUCH_FACTOR) * this.crouch) + this.air + bob;
    }
  }
  pose() { return { pos: new V3(this.pos.x, this.eyeY, this.pos.z), yaw: this.yaw, pitch: this.pitch, hfov: this.fov }; }
}

export const STANCHIONS = [1, -1].map((s) => [new V3(0, 0, s * (C.COURT_LENGTH / 2 + 2.3)), 1.3]);
