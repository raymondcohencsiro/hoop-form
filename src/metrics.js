// Biomechanical metrics evaluated on the live avatar (port of skills/base.py).
import { V3, DEG } from './math.js';
const S = (c, n) => `${n}_${c.side}`;
const G = (c, n) => `${n}_${c.side === 'R' ? 'L' : 'R'}`;
export const METRICS = {
  knee: (c) => c.avatar.jointAngle(S(c, 'hip'), S(c, 'knee'), S(c, 'ankle')),
  hip: (c) => c.avatar.jointAngle(S(c, 'shoulder'), S(c, 'hip'), S(c, 'knee')),
  elbow: (c) => c.avatar.jointAngle(S(c, 'shoulder'), S(c, 'elbow'), S(c, 'wrist')),
  wrist: (c) => c.avatar.jointAngle(S(c, 'elbow'), S(c, 'wrist'), S(c, 'fingertip')),
  arm_elevation: (c) => { const v = c.avatar.world(S(c, 'elbow')).sub(c.avatar.world(S(c, 'shoulder'))); return Math.atan2(v.y, Math.hypot(v.x, v.z)) / DEG; },
  elbow_under_ball: (c) => Math.abs(c.avatar.world(S(c, 'elbow')).sub(c.ballPos).dot(c.right_axis)) * 100,
  ball_above_eyes: (c) => (c.ballPos.y - c.avatar.world('eye').y) * 100,
  release_angle: (c) => (c.ball.released ? c.ball.release_angle : null),
  release_elbow: (c) => (c.ball.released ? c.ball.release_elbow : null),
  release_height: (c) => (c.ball.released ? c.ball.release_above_eyes : null),
  entry_angle: (c) => (!c.ball.released || c.ball.t_through == null || c.flight_t < c.ball.t_through ? null : c.ball.entry_angle),
  takeoff_knee: (c) => c.avatar.jointAngle(G(c, 'hip'), G(c, 'knee'), G(c, 'ankle')),
  drive_thigh: (c) => { const v = c.avatar.world(S(c, 'knee')).sub(c.avatar.world(S(c, 'hip'))); return Math.atan2(v.y, Math.hypot(v.x, v.z)) / DEG; },
  jump_height: (c) => c.avatar.lowest() * 100,
  feet_down: (c) => ['R', 'L'].filter((s) => Math.min(c.avatar.world(`toe_${s}`).y, c.avatar.world(`heel_${s}`).y) < 0.02).length,
  run_speed: (c) => c.speed,
  hip_drop: (c) => (c.stand_hip - c.avatar.world('pelvis').y) * 100,
  balance: (c) => {
    const a = c.avatar, heel = a.world('heel_R').add(a.world('heel_L')).mul(0.5), toe = a.world('toe_R').add(a.world('toe_L')).mul(0.5);
    const axis = new V3(toe.x - heel.x, 0, toe.z - heel.z), ln = axis.len();
    if (ln < 1e-6) return null;
    const rel = new V3(c.com.x - heel.x, 0, c.com.z - heel.z);
    return rel.dot(axis.mul(1 / ln)) / ln * 100;
  },
  trunk_lean: (c) => { const v = c.avatar.world('neck').sub(c.avatar.world('pelvis')); return Math.atan2(Math.hypot(v.x, v.z) * (v.z >= 0 ? 1 : -1), v.y) / DEG; },
};
const SEGMENTS = [['neck', 'head_c', 0.081, 0.5], ['pelvis', 'neck', 0.497, 0.5],
  ['shoulder_R', 'elbow_R', 0.028, 0.436], ['shoulder_L', 'elbow_L', 0.028, 0.436],
  ['elbow_R', 'wrist_R', 0.016, 0.43], ['elbow_L', 'wrist_L', 0.016, 0.43],
  ['wrist_R', 'fingertip_R', 0.006, 0.5], ['wrist_L', 'fingertip_L', 0.006, 0.5],
  ['hip_R', 'knee_R', 0.100, 0.433], ['hip_L', 'knee_L', 0.100, 0.433],
  ['knee_R', 'ankle_R', 0.0465, 0.433], ['knee_L', 'ankle_L', 0.0465, 0.433],
  ['ankle_R', 'toe_R', 0.0145, 0.5], ['ankle_L', 'toe_L', 0.0145, 0.5]];
export function centreOfMass(av) {
  let acc = new V3(), total = 0;
  const W = (n) => (n === 'head_c' ? av.head_center.worldPos() : av.world(n));
  for (const [a, b, m, f] of SEGMENTS) { const pa = W(a), pb = W(b); acc = acc.add(pa.add(pb.sub(pa).mul(f)).mul(m)); total += m; }
  return acc.mul(1 / total);
}
export function evaluate(check, ctx) {
  const v = METRICS[check.metric](ctx);
  if (v == null) return [null, null];
  return [v, check.lo <= v && v <= check.hi];
}
const LR = /\b(right|left|Right|Left|RIGHT|LEFT)\b/g;
const SWAP = { right: 'left', left: 'right', Right: 'Left', Left: 'Right', RIGHT: 'LEFT', LEFT: 'RIGHT' };
export function mirrorText(skill) {
  const sw = (t) => (typeof t === 'string' ? t.replace(LR, (m) => SWAP[m]) : t);
  return { ...skill, name: sw(skill.name), summary: sw(skill.summary), mnemonic: sw(skill.mnemonic),
    phases: skill.phases.map((p) => ({ ...p, title: sw(p.title), why: sw(p.why), cues: p.cues.map(sw), faults: p.faults.map(sw), drill: sw(p.drill) })) };
}
