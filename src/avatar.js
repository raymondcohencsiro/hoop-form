// Articulated, anthropometric player avatar (port of avatar.py).
// Kinematics only: the renderer builds meshes from `parts`.
// Rotation convention (degrees, local to parent): rx<0 swings a hanging limb
// forward, knee rx>0 bends, spine rx>0 leans forward, shoulder rz>0 brings the elbow in.
import { Node, V3, DEG } from './math.js';
import { buildBody } from './body.js';

export const JOINTS = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulder_R', 'elbow_R', 'twist_R', 'wrist_R', 'shoulder_L', 'elbow_L', 'twist_L', 'wrist_L',
  'hip_R', 'knee_R', 'ankle_R', 'hip_L', 'knee_L', 'ankle_L'];
export const SPINE_PROFILE = [[-0.01, 0.082], [0.04, 0.078], [0.09, 0.082], [0.13, 0.089], [0.16, 0.092]];
export const SPINE_DEPTH = 0.62;
export const CHEST_PROFILE = [[-0.005, 0.092], [0.03, 0.095], [0.07, 0.096], [0.10, 0.089], [0.118, 0.071], [0.128, 0.045], [0.132, 0.0]];
export const CHEST_DEPTH = 0.62;
const ARM_CLEARANCE = 0.004;

export class Avatar {
  constructor(settings) {
    this.s = settings;
    const H = this.H = settings.player_height;
    this.side = settings.handedness === 'right' ? 'R' : 'L';
    this.guide = this.side === 'R' ? 'L' : 'R';
    const L = this.L = {
      hip_h: 0.530 * H, thigh: 0.245 * H, shank: 0.246 * H, ankle_h: 0.039 * H, foot: 0.152 * H,
      upper_arm: 0.186 * H, forearm: 0.146 * H, hand: 0.108 * H, shoulder_x: 0.121 * H, hip_x: 0.052 * H,
    };
    this.j = {};
    this.root = this.j.root = new Node('root');
    const J = (name, parent, pos) => (this.j[name] = new Node(name, this.j[parent], pos));
    J('pelvis', 'root', [0, L.hip_h, 0]);
    J('spine', 'pelvis', [0, 0.035 * H, 0]);
    J('chest', 'spine', [0, 0.155 * H, 0]);
    J('neck', 'chest', [0, 0.125 * H, 0]);
    J('head', 'neck', [0, 0.045 * H, 0.004 * H]);
    for (const [s, sx] of [['R', 1], ['L', -1]]) {
      J(`shoulder_${s}`, 'chest', [sx * L.shoulder_x, 0.095 * H, -0.004 * H]);
      J(`elbow_${s}`, `shoulder_${s}`, [0, -L.upper_arm, 0]);
      J(`twist_${s}`, `elbow_${s}`, [0, 0, 0]);
      J(`wrist_${s}`, `twist_${s}`, [0, -L.forearm, 0]);
      J(`hip_${s}`, 'pelvis', [sx * L.hip_x, 0, 0]);
      J(`knee_${s}`, `hip_${s}`, [0, -L.thigh, 0]);
      J(`ankle_${s}`, `knee_${s}`, [0, -L.shank, 0]);
    }
    this.parts = [];
    this._buildBody();
    this._buildMarkers();
    this.planted = new V3();
  }
  // ---------------------------------------------------------------- body (render recipe)
  _part(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
    const pnode = typeof parent === 'string' ? this.j[parent] : parent;
    const sc = Array.isArray(scale) ? scale : [scale, scale, scale];
    const node = new Node('part', pnode, pos, rot, sc);
    this.parts.push({ node, geo, mat });
    return node;
  }
  _buildBody() {
    // surface recipe (skinned body + clothing + rigid detail parts) lives in body.js
    this.head_center = new Node('head_c', this.j.head, [0, 0.062 * this.H, 0.008 * this.H]);
    const b = buildBody(this);
    this.parts = b.rigid; this.skinned = b.skinned; this.bind = b.bind;
  }
  _buildMarkers() {
    const H = this.H, L = this.L, fl = L.foot * 1.04, M = this.markers = {};
    for (const s of ['R', 'L']) {
      const a = this.j[`ankle_${s}`], w = this.j[`wrist_${s}`];
      M[`toe_${s}`] = new Node('m', a, [0, -L.ankle_h, fl * 0.76]);
      M[`heel_${s}`] = new Node('m', a, [0, -L.ankle_h, -fl * 0.22]);
      M[`ball_${s}`] = new Node('m', a, [0, -L.ankle_h, fl * 0.52]);
      M[`palm_${s}`] = new Node('m', w, [0, -0.052 * H, -0.010 * H]);
      M[`fingertip_${s}`] = new Node('m', w, [0, -0.105 * H, -0.004 * H]);
      M[`hand_${s}`] = new Node('m', w, [0, -0.05 * H, 0]);
    }
    M.eye = new Node('m', this.j.head, [0, 0.07 * H, 0.06 * H]);
    this.arm_samples = {};
    for (const s of ['R', 'L']) {
      const pts = [0.35, 0.55, 0.75, 0.95].map((f) => [new Node('s', this.j[`shoulder_${s}`], [0, -f * L.upper_arm, 0]), (0.024 + (0.019 - 0.024) * f) * H * 1.08]);
      [0.2, 0.45, 0.7, 0.95].forEach((f) => pts.push([new Node('s', this.j[`elbow_${s}`], [0, -f * L.forearm, 0]), (0.022 + (0.0145 - 0.022) * f) * H * 1.08]));
      pts.push([M[`palm_${s}`], 0.012 * H]);
      this.arm_samples[s] = pts;
    }
    this.ball_anchor = new Node('ball_anchor', this.j[`wrist_${this.side}`]);
  }
  setBallAnchor(r) { const H = this.H; this.ball_anchor.setPos(0, -0.068 * H, -(r + 0.012 * H)); }
  world(name) { return (this.j[name] || this.markers[name]).worldPos(); }

  // ---------------------------------------------------------------- posing
  applyPose(pose, { guideTargetFn = null, lookTarget = null, lock = null, heading = 0 } = {}) {
    const j = this.j;
    j.root.setRot(0, heading + (pose.root_yaw ?? 0), 0);
    for (const name of JOINTS.slice(1)) {
      if (name.startsWith('ankle')) continue;
      const r = pose[name] ?? [0, 0, 0];
      j[name].setRot(r[0], r[1], r[2]);
    }
    for (const s of ['R', 'L']) {
      const hip = j[`hip_${s}`].rot, knee = j[`knee_${s}`].rot, pel = j.pelvis.rot;
      const flat = -(pel[0] + hip[0] + knee[0]);
      j[`ankle_${s}`].setRot(flat + (pose[`toes_${s}`] ?? 0), 0, -(hip[2] + pel[2]));
    }
    this._ground(lock || ['both', this.planted], pose.air ?? 0);
    if (lookTarget && (pose.look ?? 0) > 0) this._lookAt(lookTarget, pose.look);
    if (guideTargetFn && (pose.guide_ik ?? 0) > 0) this._solveGuide(guideTargetFn, pose.guide_ik);
    for (const s of ['R', 'L']) this._pushArmClear(s);
  }
  lowest(sides = ['R', 'L']) {
    let m = Infinity;
    for (const s of sides) for (const k of ['toe', 'heel']) m = Math.min(m, this.markers[`${k}_${s}`].worldPos().y);
    return m;
  }
  _ground([kind, p], air = 0) {
    const r = this.root;
    if (kind === 'free') {
      r.setPos(p.x, p.y, p.z);
      const low = this.lowest();
      if (low < 0) r.setPos(p.x, p.y - low, p.z);
      return;
    }
    r.setPos(0, 0, 0);
    const low = this.lowest();
    const anchor = kind === 'R' || kind === 'L' ? this.markers[`ball_${kind}`].worldPos()
      : this.markers.ball_R.worldPos().add(this.markers.ball_L.worldPos()).mul(0.5);
    r.setPos(p.x - anchor.x, -low + air, p.z - anchor.z);
  }
  _lookAt(target, weight = 1) {
    const j = this.j, eye = this.markers.eye.worldPos(), d = target.sub(eye);
    const yawT = Math.atan2(d.x, d.z) / DEG, elev = Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG;
    const chainPitch = j.pelvis.rot[0] + j.spine.rot[0] + j.chest.rot[0];
    const chainYaw = j.root.rot[1] + j.pelvis.rot[1] + j.spine.rot[1] + j.chest.rot[1];
    // a real neck turns ~70 deg at most: when the target ends up behind (e.g. after running
    // under the basket on a layup) ease back toward looking ahead instead of craning round
    let rel = ((yawT - chainYaw + 540) % 360) - 180;
    const behind = Math.min(1, Math.max(0, (Math.abs(rel) - 65) / 45)), w = weight * (1 - behind * behind * (3 - 2 * behind));
    rel = Math.max(-70, Math.min(70, rel));
    const pitch = Math.max(-32, (-elev - chainPitch) * w), yaw = rel * w;
    j.neck.setRot(pitch * 0.4, yaw * 0.4, 0);
    j.head.setRot(pitch * 0.6, yaw * 0.6, 0);
  }
  _solveGuide(targetFn, weight, iters = 20) {
    const g = this.guide, sh = this.j[`shoulder_${g}`], el = this.j[`elbow_${g}`];
    const eff = this.markers[`palm_${g}`], samples = this.arm_samples[g], target = targetFn();
    const q0 = [sh.rot[0], sh.rot[1], sh.rot[2], el.rot[0]];
    const setq = (v) => { sh.setRot(v[0], v[1], v[2]); el.setRot(Math.min(v[3], 5), el.rot[1], el.rot[2]); };
    const residual = (v) => {
      setq(v);
      const hand = eff.worldPos(), e = hand.sub(target).mul(2);
      const out = [e.x, e.y, e.z];
      for (const [ent, r] of samples) out.push(6 * Math.max(0, ARM_CLEARANCE - this._torsoClearance(ent, r)));
      const limit = Math.max(hand.y, sh.worldPos().y - 0.12 * this.H / 1.6);
      out.push(3 * Math.max(0, el.worldPos().y - limit));
      for (let i = 0; i < 4; i++) out.push(0.0005 * (v[i] - q0[i]));
      return out;
    };
    const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
    let q = q0.slice(), r = residual(q), lam = 1e-7;
    const nS = samples.length;
    for (let it = 0; it < iters; it++) {
      const pen = Math.max(...r.slice(3, 3 + nS + 1));
      if (r[0] * r[0] + r[1] * r[1] + r[2] * r[2] < 1.6e-5 && pen <= 0) break;
      const J = [];
      for (let i = 0; i < 4; i++) {
        const dq = q.slice(); dq[i] += 0.5;
        const rd = residual(dq);
        J.push(rd.map((x, k) => (x - r[k]) / 0.5));       // column i
      }
      // Levenberg-Marquardt: if no step improves, raise the damping and retry
      const JTJ = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) { for (let c = 0; c < 4; c++) JTJ[a][c] = dot(J[a], J[c]); g[a] = -dot(J[a], r); }
      const base = dot(r, r);
      let moved = false;
      for (let tries = 0; tries < 6 && !moved; tries++) {
        const A = JTJ.map((row, a) => row.map((x, c) => x + (a === c ? lam * (1 + JTJ[a][a]) : 0)));
        const step = solve(A, g).map((x) => Math.max(-15, Math.min(15, x)));
        for (const sc of [1, 0.5, 0.25]) {
          const cand = q.map((x, i) => x + step[i] * sc), rc = residual(cand);
          if (dot(rc, rc) < base) { q = cand; r = rc; moved = true; break; }
        }
        lam = moved ? Math.max(lam / 10, 1e-9) : lam * 30;
      }
      if (!moved) break;
    }
    if (weight < 1) q = q0.map((x, i) => x + (q[i] - x) * weight);
    setq(q);
  }
  _pushArmClear(side, maxIters = 12) {
    const sh = this.j[`shoulder_${side}`], sgn = side === 'R' ? -1 : 1;
    for (let i = 0; i < maxIters; i++) {
      if (this.armClearance(side) >= ARM_CLEARANCE * 0.5) return;
      sh.setRot(sh.rot[0], sh.rot[1], sh.rot[2] + sgn * 2);
    }
  }
  _torsoClearance(ent, radius) {
    let best = 1;
    const H = this.H;
    for (const [joint, prof, depth] of [['spine', SPINE_PROFILE, SPINE_DEPTH], ['chest', CHEST_PROFILE, CHEST_DEPTH]]) {
      const p = this.j[joint].relPoint(ent), y = p.y / H;
      if (y < prof[0][0] || y > prof[prof.length - 1][0]) continue;
      let a = 0;
      for (let i = 0; i < prof.length - 1; i++) {
        const [y0, r0] = prof[i], [y1, r1] = prof[i + 1];
        if (y0 <= y && y <= y1) { a = (r0 + (r1 - r0) * (y - y0) / (y1 - y0)) * H; break; }
      }
      const A = a + radius, B = a * depth + radius;
      const q = Math.sqrt((p.x / A) ** 2 + (p.z / B) ** 2);
      best = Math.min(best, (q - 1) * Math.min(A, B));
    }
    return best;
  }
  armClearance(side) { return Math.min(...this.arm_samples[side].map(([e, r]) => this._torsoClearance(e, r))); }
  jointAngle(a, b, c) {
    const A = this.world(a), B = this.world(b), Cc = this.world(c);
    const d = Math.max(-1, Math.min(1, A.sub(B).norm().dot(Cc.sub(B).norm())));
    return Math.acos(d) / DEG;
  }
}
function solve(A, b) {   // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return new Array(n).fill(0);
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
