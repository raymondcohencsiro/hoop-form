// Headless coaching core (port of app.py's Coach logic, no rendering).
// Drives the avatar and ball for a skill; the renderer and HUD read from it.
import { V3, DEG } from './math.js';
import * as C from './config.js';
import { Timeline, mirrorPose } from './animation.js';
import { Avatar } from './avatar.js';
import { BallPhysics } from './ball.js';
import { Gait, smooth } from './gait.js';
import { METRICS, centreOfMass, mirrorText, evaluate } from './metrics.js';

const DRIBBLE_WIDEN = 0;   // extra shoulder abduction (deg) while dribbling

export class CoachCore {
  constructor(settings, skillsData) {
    this.s = settings; this.skillsData = skillsData;
    this.rim = new V3(0, settings.rim_height, C.basketZ());
    this.t = 0;
    this.loadSkill(settings.skill);
  }
  loadSkill(key) {
    this.skill = this.skillsData.skills.find((k) => k.key === key);
    this.s.skill = key;
    this.ball = new BallPhysics(C.ballRadius(this.s));
    this._buildPlayer();
    this.seek(0);
  }
  rebuild() { this.ball = new BallPhysics(C.ballRadius(this.s)); this._buildPlayer(); this.seek(Math.min(this.t, this.end_time)); }

  _buildPlayer() {
    const sk = this.skill;
    this.lefty = this.s.handedness === 'left';
    const mx = this.lefty ? -1 : 1;
    this.timeline = new Timeline(sk, this.lefty);
    this.display_skill = this.lefty ? mirrorText(sk) : sk;
    this.heading = sk.heading * mx;
    this.stances = sk.phases.map((p) => (this.lefty && (p.stance === 'R' || p.stance === 'L') ? (p.stance === 'R' ? 'L' : 'R') : p.stance));
    this.avatar = new Avatar(this.s);
    this.avatar.setBallAnchor(C.ballRadius(this.s));
    this.spot = new V3(sk.spot[0] * mx, 0, sk.spot[1]);
    this.avatar.planted = this.spot.clone();
    this.avatar.applyPose({});
    this.player_eye_height = this.avatar.world('eye').y;
    this.gait = null; this._dribbleCache = {};
    if (sk.gait) this._buildGait(); else this._planFootwork();
    if (sk.align_phase) {
      const setT = this.timeline.times[sk.phases.findIndex((p) => p.key === sk.align_phase) + 1];
      for (let i = 0; i < 3; i++) {
        this._apply(setT);
        const dx = this.avatar.ball_anchor.worldPos().x - this.rim.x;
        this.spot = new V3(this.spot.x - dx, 0, this.spot.z);
        this._planFootwork();
      }
    }
    this.avatar.planted = this.spot.clone();
    const rt = this.timeline.release_time;
    this._apply(rt);
    const p0 = this.avatar.ball_anchor.worldPos();
    this.angle = this.s.release_angle || sk.release_angle;
    let bank = null;
    if (sk.bank) bank = { board_z: C.COURT_LENGTH / 2 - C.BACKBOARD_FROM_BASELINE, side: p0.x >= this.rim.x ? 1 : -1,
      aim_height: this.s.release_angle ? null : sk.bank_aim_above_rim };
    this.ball.computeFlight(p0, this.rim, this.angle, this.s.backspin_rps, this.rim, bank);
    this.angle = this.ball.release_angle;
    this._retimeRelease();
    this._matchRelease();
    this.ballPos = p0;
    this.ball.release_elbow = METRICS.elbow(this._ctx());
    this.ball.release_above_eyes = (p0.y - this.avatar.world('eye').y) * 100;
    this.end_time = Math.max(this.timeline.total, rt + Math.min(this.ball.flight_duration, 2.8));
  }
  /**
   * Ball roll-off at release. Up to the release the hand animation only carries the
   * ball at ~2-3 m/s (mostly the wrist snap, i.e. horizontally), while the flight
   * leaves at the launch velocity (~7 m/s at ~50 deg) - so the ball used to change
   * direction and speed instantly. As in a real shot, the ball now starts rolling off
   * the fingers just before release: from TS s before release it follows a cubic
   * Hermite curve that starts with the hand's own position + velocity and joins the
   * exact physics flight TJ s after release with the flight's position + velocity.
   * Position and velocity are continuous; the flight, release pose and checkpoints
   * are unchanged.
   */
  /**
   * Make the arm really throw. The authored key poses ease the joints to a stop at the
   * release key, so at the release instant the arm alone was moving the hand down and
   * forward (-23 deg on a free throw) at ~2 m/s while the flight leaves at ~7 m/s and
   * ~55 deg. A real shooter pushes the ball out along the line it will fly: the shoulder
   * keeps raising the arm while the elbow straightens, so the hand travels along the
   * launch direction and is fastest at the moment the ball leaves the fingers.
   *
   * Over the last T s before release the ball anchor follows a cubic Hermite path from
   * the hand's own position + velocity (the authored motion into the set point) to the
   * unchanged release point with exactly the launch velocity. Shoulder flexion,
   * shoulder abduction and elbow are solved by damped Newton IK at each sample; the wrist
   * stays cocked and snaps late, the forearm twist blends. After release the joints keep
   * their speed and decelerate (without overshoot) into the follow-through pose. The
   * release pose, release point, flight and checkpoints are unchanged.
   */
  _retimeRelease() {
    const tl = this.timeline, rt = tl.release_time, b = this.ball;
    this.armAt = null; this.throwInfo = null;
    if (rt == null || !b.v0) return;
    const S = this.avatar.side, CH = { sh: `shoulder_${S}`, el: `elbow_${S}`, wr: `wrist_${S}`, tw: `twist_${S}` };
    if (!Object.values(CH).every((c) => tl.channels.includes(c))) return;
    const T = 0.12, N = 12, tA = rt - T, h = 0.002, dt = T / N;
    const armOf = (p) => ({ [CH.sh]: p[CH.sh].slice(), [CH.el]: p[CH.el].slice(), [CH.wr]: p[CH.wr].slice(), [CH.tw]: p[CH.tw].slice() });
    const anchor = (t, arm) => { this.armAt = arm ? () => arm : null; this._apply(t); this.armAt = null; return this.avatar.ball_anchor.worldPos(); };
    const qA = armOf(tl.poseAt(tA)), qR = armOf(tl.poseAt(rt));
    const pA = anchor(tA), vA = anchor(tA + h).sub(anchor(tA - h)).mul(1 / (2 * h)), pR = anchor(rt, qR), v0 = b.v0;
    const DOF = [[CH.sh, 0], [CH.sh, 2], [CH.el, 0]];
    const withX = (q, xx) => { const o = { ...q, [CH.sh]: q[CH.sh].slice(), [CH.el]: q[CH.el].slice() }; DOF.forEach(([c, i], j) => { o[c][i] = xx[j]; }); return o; };
    const jac = (t, q, f0) => DOF.map((_, j) => { const xx = DOF.map(([c, i]) => q[c][i]); xx[j] += 0.4; return anchor(t, withX(q, xx)).sub(f0).mul(1 / 0.4); });
    // How fast must the joints turn at release? Body (legs, trunk, jump) and the late wrist snap
    // give part of the velocity; shoulder + elbow give the rest. Cap them at realistic peaks
    // and let the fingertips (roll-off) add whatever is left.
    const CAP = { sh: 1000, abd: 700, el: 1500 };
    const wEnd = 3 * (qR[CH.wr][0] - qA[CH.wr][0]) / T;                                   // u^3 wrist schedule
    const vBody = anchor(rt + h, qR).sub(anchor(rt - h, qR)).mul(1 / (2 * h));
    const Jr = jac(rt, qR, pR);
    const qW = { ...qR, [CH.wr]: qR[CH.wr].slice() }; qW[CH.wr][0] += 0.4;
    const vWrist = anchor(rt, qW).sub(pR).mul(wEnd / 0.4);
    const need = v0.sub(vBody).sub(vWrist);
    const qdFull = solve3(Jr.map((Jc, i) => Jr.map((Jd, j) => Jc.dot(Jd) + (i === j ? 1e-7 : 0))), Jr.map((Jc) => Jc.dot(need)));
    const alpha = Math.min(1, CAP.sh / Math.abs(qdFull[0] || 1e-9), CAP.abd / Math.abs(qdFull[1] || 1e-9), CAP.el / Math.abs(qdFull[2] || 1e-9));
    const vEnd = vBody.add(vWrist).add(need.mul(alpha));
    const herm = (u) => { const u2 = u * u, u3 = u2 * u;
      return pA.mul(2 * u3 - 3 * u2 + 1).add(vA.mul((u3 - 2 * u2 + u) * T)).add(pR.mul(-2 * u3 + 3 * u2)).add(vEnd.mul((u3 - u2) * T)); };
    const lerpArr = (a, c, u) => a.map((v, k) => v + (c[k] - v) * u);
    const samples = [{ t: tA, q: qA }];
    let x = DOF.map(([c, i]) => qA[c][i]), worst = 0;
    for (let k = 1; k <= N; k++) {
      const u = k / N, t = tA + T * u, target = herm(u);
      const prior = { [CH.sh]: lerpArr(qA[CH.sh], qR[CH.sh], u), [CH.el]: lerpArr(qA[CH.el], qR[CH.el], u),
        [CH.wr]: lerpArr(qA[CH.wr], qR[CH.wr], u ** 3), [CH.tw]: lerpArr(qA[CH.tw], qR[CH.tw], u) };     // wrist snaps late
      if (k === N) { samples.push({ t, q: qR }); break; }
      let f = anchor(t, withX(prior, x)).sub(target);
      const J = jac(t, withX(prior, x), f.add(target));                                    // chord Newton: one Jacobian per sample
      const A = J.map((Ji, i) => J.map((Jj, j) => Ji.dot(Jj) + (i === j ? 1e-6 * [1, 4, 1][i] : 0)));
      for (let it = 0; it < 4 && f.len() > 3e-4; it++) {
        const dx = solve3(A, J.map((Ji) => -Ji.dot(f)));
        x = x.map((v, j) => v + Math.max(-20, Math.min(20, dx[j])));
        f = anchor(t, withX(prior, x)).sub(target);
      }
      worst = Math.max(worst, f.len());
      samples.push({ t, q: withX(prior, x) });
    }
    // joint speeds into release; after release they carry on and ease (no overshoot) into the follow-through
    const qd = {}, last = samples[N].q, prev = samples[N - 1].q;
    for (const c of Object.keys(last)) qd[c] = last[c].map((v, i) => (v - prev[c][i]) / dt);
    let iF = tl.times.findIndex((x2) => x2 > rt + 0.2); if (iF < 0) iF = tl.times.length - 1;
    const tF = tl.times[iF], qF = armOf(tl.poseAt(tF)), hB = tF - rt, mOut = {};
    for (const c of Object.keys(qR)) mOut[c] = qR[c].map((v, i) => { const d = qF[c][i] - v, m = qd[c][i]; if (d * m <= 0) return 0; return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(d) / hB); });
    const after = (t) => { const u = (t - rt) / hB, u2 = u * u, u3 = u2 * u, o = {};
      for (const c of Object.keys(qR)) o[c] = qR[c].map((v, i) => (2 * u3 - 3 * u2 + 1) * v + (u3 - 2 * u2 + u) * hB * mOut[c][i] + (-2 * u3 + 3 * u2) * qF[c][i]);
      return o; };
    const armAt = (t) => {
      if (t < tA || t > tF) return null;
      if (t >= rt) return after(t);
      const f = (t - tA) / dt, i = Math.min(N - 1, Math.floor(f)), w = f - i, A = samples[i].q, Bq = samples[i + 1].q, o = {};
      for (const c of Object.keys(A)) o[c] = A[c].map((v, k2) => v + (Bq[c][k2] - v) * w);
      return o;
    };
    const peak = (c, i) => Math.max(...samples.slice(1).map((sm, k) => Math.abs(sm.q[c][i] - samples[k].q[c][i]) / dt));
    this.armAt = armAt;
    this._apply(rt); const pr = this.avatar.ball_anchor.worldPos(); this._apply(rt - 0.004);
    const vHand = pr.sub(this.avatar.ball_anchor.worldPos()).mul(1 / 0.004);
    this.throwInfo = { ikError: worst, alpha, vHand, launch: v0.len(), handShare: vHand.len() / v0.len(),
      elbowPeak: peak(CH.el, 0), shoulderPeak: peak(CH.sh, 0), wristPeak: peak(CH.wr, 0) };
    if (worst > 0.02) { this.armAt = null; this.throwInfo.fallback = true; }                 // unreachable: keep the authored motion
    this._apply(rt);
  }
  _matchRelease() {
    const rt = this.timeline.release_time, b = this.ball;
    this.rollOff = null;
    if (rt == null || !b.samples.length) return;
    // with the solved throw the hand already moves along the launch line; the fingertips
    // only add the last part, so the ball leaves the palm just before release
    const thrown = this.armAt && this.throwInfo && !this.throwInfo.fallback;
    const TS = thrown ? 0.025 : 0.045, TJ = thrown ? 0.045 : 0.06, ta = rt - TS, h = 0.002;
    const at = (t) => { this._apply(t); return this.avatar.ball_anchor.worldPos(); };
    const pA = at(ta), vA = at(ta + h).sub(at(ta - h)).mul(1 / (2 * h));
    const [pJ] = b.sample(TJ), [p2] = b.sample(TJ + h), [p1] = b.sample(TJ - h);
    const vJ = p2.sub(p1).mul(1 / (2 * h)), [, spinJ] = b.sample(TJ);
    this.rollOff = { ta, tj: rt + TJ, pA, vA, pJ, vJ, spinJ };
    this._apply(rt);
  }
  _rollOffAt(t) {
    const r = this.rollOff, T = r.tj - r.ta, u = (t - r.ta) / T, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const p = r.pA.mul(h00).add(r.vA.mul(h10 * T)).add(r.pJ.mul(h01)).add(r.vJ.mul(h11 * T));
    return [p, r.spinJ * u2 * (3 - 2 * u)];
  }
  _buildGait() {
    const sk = this.skill, mx = this.lefty ? -1 : 1;
    const trial = new Gait(sk.gait, this.avatar, new V3(), this.heading, this.lefty);
    const a = sk.gait_anchor, cs = trial.spec.contacts;
    const c = typeof a.contact === 'string' ? cs.find((x) => x[a.contact]) : cs[a.contact];
    const want = new V3(this.rim.x, 0, this.rim.z).sub(trial.fwd.mul(a.before_rim * trial.k)).add(trial.right.mul(a.line_offset * trial.k * mx));
    const origin = want.sub(c.world);
    this.gait = new Gait(sk.gait, this.avatar, origin, this.heading, this.lefty);
    this.spot = new V3(origin.x, 0, origin.z);
  }
  _planFootwork() {
    const av = this.avatar, tl = this.timeline, sk = this.skill, phases = sk.phases, n = phases.length;
    const hd = this.heading * DEG, fwd = new V3(Math.sin(hd), 0, Math.cos(hd));
    const [apex, travel] = sk.flight;
    const key = (k, lock) => av.applyPose(tl.poseAt(tl.times[k]), { lock, heading: this.heading });
    const plan = [];
    let lock = ['both', this.spot.clone()], i = 0;
    while (i < n) {
      key(i, lock);
      const st = this.stances[i];
      if (st === 'air') {
        let j = i; while (j < n && this.stances[j] === 'air') j++;
        const r0 = av.root.worldPos(), land = r0.add(fwd.mul(travel));
        key(j, ['free', new V3(land.x, -5, land.z)]);
        const r1 = av.root.worldPos();
        for (let k = i; k < j; k++) plan.push(['air', [r0, r1, phases[k].arc, apex]]);
        lock = ['free', r1]; i = j; continue;
      }
      const anchor = st === 'both' ? av.markers.ball_R.worldPos().add(av.markers.ball_L.worldPos()).mul(0.5) : av.markers[`ball_${st}`].worldPos();
      lock = [st, new V3(anchor.x, 0, anchor.z)];
      plan.push(lock); i++;
    }
    this.plan = plan;
  }
  _lockAt(t) {
    const tt = Math.min(t, this.timeline.total);
    if (this.gait) return ['free', this.gait.root(tt)];
    const [i, u] = this.timeline.segment(tt);
    const [kind, data] = this.plan[i];
    if (kind !== 'air') return [kind, data];
    const [r0, r1, [s0, s1], h] = data, s = s0 + (s1 - s0) * u, p = r0.lerp(r1, s);
    return ['free', new V3(p.x, r0.y + (r1.y - r0.y) * s + 4 * h * s * (1 - s), p.z)];
  }
  rightAxis() { const y = this.avatar.root.rot[1] * DEG; return new V3(Math.cos(y), 0, -Math.sin(y)); }
  _guideTarget() {
    const sign = this.avatar.side === 'R' ? -1 : 1, c = this.avatar.ball_anchor.worldPos();
    return c.add(this.rightAxis().mul(sign * (C.ballRadius(this.s) + 0.004))).add(new V3(0, 0.01, -0.01));
  }
  _apply(t) {
    const tt = Math.min(t, this.timeline.total);
    this.pose = this.timeline.poseAt(tt);
    // around the release the shooting arm follows the solved throwing motion (see _retimeRelease)
    if (this.armAt) { const o = this.armAt(tt); if (o) Object.assign(this.pose, o); }
    if (this.gait) this.gait.applyToPose(tt, this.pose, this.heading + (this.pose.root_yaw ?? 0));
    this._dribbleArm(t);
    this._runArms(t);
    this.avatar.applyPose(this.pose, { guideTargetFn: () => this._guideTarget(), lookTarget: this._lookTarget(t), lock: this._lockAt(t), heading: this.heading });
  }
  /**
   * Where the eyes go. On the move (layup) they stay on the rim through the release; then
   * the target glides to a point ahead at eye height as the player runs under the basket,
   * so the head eases back to looking forward instead of craning round to the rim.
   */
  _lookTarget(t) {
    const rt = this.timeline.release_time;
    if (!this.gait || rt == null || t <= rt + 0.05) return this.rim;
    const u = smooth((t - rt - 0.05) / 0.45), hd = (this.heading + (this.pose.root_yaw ?? 0)) * DEG;
    const root = this.avatar.root.worldPos(), k = this.s.player_height / 1.6;
    const ahead = new V3(root.x + Math.sin(hd) * 6, this.player_eye_height ?? 1.5 * k, root.z + Math.cos(hd) * 6);
    return this.rim.lerp(ahead, u);
  }
  /**
   * While running, the free (guide) arm swings against the legs: forward as the shooting-side
   * leg plants, back as the guide-side leg plants. It fades out for the two-hand gather.
   */
  _runArms(t) {
    if (!this.gait) return;
    const cs = this.gait.spec.contacts.filter((c) => !c.from_air && c.t0 > 0).sort((a, b) => a.t0 - b.t0);
    const gather = cs.find((c) => c.foot === 'S' && c.t0 > (this.skill.dribbles?.at(-1)?.catch ?? 0) - 0.05);
    if (cs.length < 3 || !gather) return;
    const tEnd = gather.t0, w = smooth((t - cs[0].t0) / 0.4) * (1 - smooth((t - (tEnd - 0.12)) / 0.2));
    if (w <= 0) return;
    const mids = cs.map((c) => [0.5 * (c.t0 + c.t1), c.foot === 'S' ? 1 : -1]);
    let sig = 0;
    for (let i = 0; i < mids.length - 1; i++) {
      const [ta, a] = mids[i], [tb, b] = mids[i + 1];
      if (t >= ta && t <= tb) { const u = (t - ta) / (tb - ta); sig = a + (b - a) * (1 - Math.cos(Math.PI * u)) / 2; break; }
    }
    const G = this.avatar.side === 'R' ? 'L' : 'R', sh = this.pose[`shoulder_${G}`], el = this.pose[`elbow_${G}`];
    if (!sh || (this.pose.guide_ik ?? 0) > 0.5) return;
    this.pose[`shoulder_${G}`] = [sh[0] - 24 * sig * w, sh[1], sh[2]];
    if (el) this.pose[`elbow_${G}`] = [el[0] - 8 * Math.max(0, sig) * w, el[1], el[2]];          // bends a little more on the forward swing
  }
  _dribbleArm(t) {
    const sk = this.skill;
    if (!sk.dribble_push || !sk.dribbles) return;
    const dbs = sk.dribbles, r0 = dbs[0].release, cLast = dbs[dbs.length - 1].catch;
    if (t < cLast && t > r0 - 0.16) this.pose.guide_ik = (this.pose.guide_ik ?? 0) * (1 - smooth((t - (r0 - 0.16)) / 0.12));
    // hold: from just before the first push to the last catch, the dribbling hand rides at waist
    // height in front of the hip, palm down on the ball (the 'speed_dribble' arm pose)
    const holdPh = sk.phases.find((p) => p.key === 'speed_dribble');
    const wh = t < cLast ? smooth((t - (r0 - 0.4)) / 0.3) : 1 - smooth((t - cLast) / 0.15);
    if (holdPh && wh > 0) {
      const S = this.avatar.side, hold = this.lefty ? mirrorPose(holdPh.pose) : holdPh.pose;
      for (const ch of [`shoulder_${S}`, `elbow_${S}`, `wrist_${S}`, `twist_${S}`]) {
        const cur = this.pose[ch] ?? [0, 0, 0], v = hold[ch]; if (!v) continue;
        this.pose[ch] = cur.map((c, i) => c + (v[i] - c) * wh);
      }
    }
    let w = 0;
    for (const db of dbs) {
      const r = db.release, f = db.floor;
      if (r - 0.16 <= t && t <= r) w = Math.max(w, smooth((t - (r - 0.16)) / 0.16));
      else if (r < t && t <= f + 0.10) w = Math.max(w, 1 - smooth((t - r) / (f + 0.10 - r)));
    }
    if (w <= 0) return;
    const push = this.lefty ? mirrorPose(sk.dribble_push) : sk.dribble_push;
    for (const [ch, v0] of Object.entries(push)) {
      const cur = this.pose[ch] ?? [0, 0, 0];
      // dribble a little wider than the data's pose so the ball clears the thigh
      const v = ch.startsWith('shoulder_') ? [v0[0], v0[1], v0[2] + (this.lefty ? 1 : -1) * DRIBBLE_WIDEN] : v0;   // -z = abduction on the right arm
      this.pose[ch] = cur.map((c, i) => c + (v[i] - c) * w);
    }
  }
  /**
   * The dribble's ball path, smooth in both directions:
   *  down - leaves the hand with the hand's velocity, falls with gravity plus the push to the floor;
   *  up   - leaves the floor with the speed that gravity alone would need to reach the hand, and
   *         arrives with the hand's velocity at the catch (so it settles into the palm without a jolt).
   * Horizontally it keeps one smooth speed through the bounce. Cubic Hermite pieces, so position and
   * velocity are continuous everywhere except the bounce itself (where only the vertical flips).
   */
  _dribblePath(t, db, P) {
    const { pRel, vRel, floor, pCat, vCat } = P, g = 9.81;
    const Td = db.floor - db.release, Tu = db.catch - db.floor;
    const vh = pCat.sub(pRel).mul(1 / (db.catch - db.release));                   // average horizontal motion through the bounce
    const vB = new V3(vh.x, 0, vh.z);
    const herm = (p0, v0, p1, v1, T, u) => { const u2 = u * u, u3 = u2 * u;
      return p0.mul(2 * u3 - 3 * u2 + 1).add(v0.mul((u3 - 2 * u2 + u) * T)).add(p1.mul(-2 * u3 + 3 * u2)).add(v1.mul((u3 - u2) * T)); };
    if (t <= db.floor) {
      const u = Math.max(0, (t - db.release) / Td);
      const a = 2 * (floor.y - pRel.y - vRel.y * Td) / (Td * Td), vyIn = vRel.y + a * Td;         // constant push + gravity down
      return herm(pRel, vRel, floor, new V3(vB.x, vyIn, vB.z), Td, u);
    }
    const u = Math.min(1, (t - db.floor) / Tu), vyUp = (pCat.y - floor.y + 0.5 * g * Tu * Tu) / Tu;
    return herm(floor, new V3(vB.x, vyUp, vB.z), pCat, vCat, Tu, u);
  }
  _handAt(t) { const h = 0.004; this._apply(t); const p = this.avatar.ball_anchor.worldPos();
    this._apply(t - h); const q = this.avatar.ball_anchor.worldPos(); return [p, p.sub(q).mul(1 / h)]; }
  _dribblePoints(db, i) {
    if (!this._dribbleCache[i]) {
      const saved = this.t;
      const [pRel, vRel] = this._handAt(db.release), [pCat, vCat] = this._handAt(db.catch);
      // when it hits the floor: the time that makes the bounce honest - it comes up at about 78% of
      // the speed it went down (a leather ball on maple), and the push never pulls it down slower than gravity
      const R0 = C.ballRadius(this.s), g = 9.81;
      let best = [Infinity, db.floor];
      for (let tf = db.release + 0.1; tf <= db.catch - 0.12; tf += 0.002) {
        const Td = tf - db.release, Tu = db.catch - tf, a = 2 * (R0 - pRel.y - vRel.y * Td) / (Td * Td);
        const vIn = vRel.y + a * Td, vUp = (pCat.y - R0 + 0.5 * g * Tu * Tu) / Tu;
        const e = (vUp - 0.78 * -vIn) ** 2 + (a > -g ? 50 * (a + g) ** 2 : 0) + 4 * (tf - db.floor) ** 2;
        if (e < best[0]) best = [e, tf];
      }
      db = { ...db, floor: best[1] };
      this._apply(db.floor);
      const pel = this.avatar.j.pelvis.worldPos(), hd = this.heading * DEG;
      const fwd = new V3(Math.sin(hd), 0, Math.cos(hd)), right = new V3(Math.cos(hd), 0, -Math.sin(hd)).mul(this.lefty ? -1 : 1);
      const k = this.s.player_height / 1.6, base = pel.add(fwd.mul(db.ahead * k));
      const pts = { pRel, vRel, pCat, vCat };
      const out = this._clearDribble(db, pts, base, right, db.outside * k);
      const p = base.add(right.mul(out));
      this._dribbleCache[i] = { ...pts, floor: new V3(p.x, C.ballRadius(this.s), p.z), db };
      this._apply(saved);
    }
    return this._dribbleCache[i];
  }
  /**
   * Push the bounce point out to the side until the ball's whole path (hand -> floor
   * -> hand) keeps clear of both legs. The legs don't depend on the bounce point, so they
   * are sampled once and the search is pure geometry.
   */
  _clearDribble(db, pts, base, right, out0) {
    const H = this.s.player_height, R = C.ballRadius(this.s), margin = 0.025, y0 = R;
    const smp = [];
    for (let t = db.release; t <= db.catch + 1e-9; t += 0.02) {
      this._apply(t);
      const j = this.avatar.j, m = this.avatar.markers, segs = [];
      for (const sd of ['R', 'L']) {
        segs.push([j[`hip_${sd}`].worldPos(), j[`knee_${sd}`].worldPos(), 0.062 * H], [j[`knee_${sd}`].worldPos(), j[`ankle_${sd}`].worldPos(), 0.04 * H],   // thigh incl. loose shorts
          [j[`ankle_${sd}`].worldPos(), m[`toe_${sd}`].worldPos(), 0.04 * H]);
      }
      smp.push({ t, segs });
    }
    const segDist = (p, a, b) => { const ab = b.sub(a), u = Math.max(0, Math.min(1, p.sub(a).dot(ab) / ab.dot(ab))); return p.sub(a.add(ab.mul(u))).len(); };
    const gapFor = (o) => {
      const fp = base.add(right.mul(o)), P = { ...pts, floor: new V3(fp.x, y0, fp.z) };
      let g = Infinity;
      for (const sm of smp) { const b = this._dribblePath(sm.t, db, P); for (const [a, c, r] of sm.segs) g = Math.min(g, segDist(b, a, c) - r - R); }
      return g;
    };
    let o = out0;
    while (gapFor(o) < margin && o < 0.55 * H / 1.6) o += 0.01;
    return o;
  }
  _dribblePos(t, db, i) { const P = this._dribblePoints(db, i); return this._dribblePath(t, P.db, P); }
  seek(t) {
    this.t = t;
    this._apply(t);
    const rt = this.timeline.release_time, b = this.ball, yaw = Math.atan2(b.dir.x, b.dir.z) / DEG;
    const ro = this.rollOff;
    if (ro && t >= ro.ta && t < ro.tj) {
      b.released = t >= rt;
      const [p, spin] = this._rollOffAt(t);
      this.ballPos = p; this.ballRot = [spin, yaw, 0];
    } else if (t < rt) {
      b.released = false;
      this.ballPos = this.avatar.ball_anchor.worldPos();
      this.ballRot = [0, yaw, 0];
      (this.skill.dribbles || []).some((db, i) => {
        if (db.release <= t && t < db.catch) { this.ballPos = this._dribblePos(t, db, i); return true; }
        return false;
      });
    } else {
      b.released = true;
      const [p, spin] = b.sample(t - rt);
      this.ballPos = p; this.ballRot = [spin, yaw, 0];
    }
    this.ctx = this._ctx();
  }
  _ctx() {
    return { avatar: this.avatar, side: this.avatar.side, ball: this.ball, ballPos: this.ballPos ?? this.avatar.ball_anchor.worldPos(),
      right_axis: this.rightAxis(), com: centreOfMass(this.avatar),
      speed: this.gait ? this.gait.speed(Math.min(this.t, this.timeline.total)) : null,
      stand_hip: this.avatar.L.hip_h, flight_t: this.timeline.release_time != null ? this.t - this.timeline.release_time : -1 };
  }
  metric(name) { return METRICS[name](this.ctx); }
  checks(phase) { return phase.checks.map((ch) => { const [v, ok] = evaluate(ch, this.ctx); return { ...ch, value: v, ok }; }); }
  focus() {
    if (this.skill.moving) { const p = this.avatar.j.pelvis.worldPos(); return new V3(p.x, 0, p.z); }
    return this.avatar.planted;
  }
}


function solve3(A, y) {             // 3x3 Gaussian elimination with partial pivoting
  const n = 3, M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / (M[c][c] || 1e-12); for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = [0, 0, 0];
  for (let r = n - 1; r >= 0; r--) { let v = M[r][n]; for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k]; x[r] = v / (M[r][r] || 1e-12); }
  return x;
}
