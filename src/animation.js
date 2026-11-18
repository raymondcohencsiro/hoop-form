// Keyframe timeline: monotone cubic Hermite interpolation between key poses
// (no overshoot, so each joint hits its key value exactly).
export function mirrorPose(pose) {
  const out = {};
  for (const [k, v] of Object.entries(pose)) {
    let nk = k;
    if (k.endsWith('_R')) nk = k.slice(0, -2) + '_L';
    else if (k.endsWith('_L')) nk = k.slice(0, -2) + '_R';
    if (Array.isArray(v) && v.length === 3) out[nk] = [v[0], -v[1], -v[2]];
    else if (k === 'root_yaw') out[nk] = -v;
    else out[nk] = v;
  }
  return out;
}
const asList = (v) => (Array.isArray(v) ? v.slice() : [Number(v)]);

export class Timeline {
  constructor(skill, leftHanded = false) {
    this.skill = skill;
    let keys = [skill.rest_pose, ...skill.phases.map((p) => p.pose)];
    if (leftHanded) keys = keys.map(mirrorPose);
    this.keys = keys;
    this.times = [0];
    for (const p of skill.phases) this.times.push(this.times[this.times.length - 1] + p.duration);
    this.total = this.times[this.times.length - 1];
    const names = new Set();
    keys.forEach((k) => Object.keys(k).forEach((n) => names.add(n)));
    this.channels = [...names].sort();
    this.vals = {}; this.tangents = {}; this.dims = {};
    for (const ch of this.channels) {
      const ref = keys.find((k) => ch in k)[ch];
      const dim = asList(ref).length;
      this.dims[ch] = dim;
      this.vals[ch] = keys.map((k) => (ch in k ? asList(k[ch]) : new Array(dim).fill(0)));
      this.tangents[ch] = this._tangents(this.vals[ch]);
    }
    if (skill.release_phase) {
      const i = skill.phases.findIndex((p) => p.key === skill.release_phase);
      this.release_time = this.times[i] + skill.phases[i].duration * skill.release_fraction;
    } else this.release_time = null;
  }
  _tangents(seq) {
    const n = seq.length, t = this.times, dim = seq[0].length, out = [];
    for (let i = 0; i < n; i++) {
      const m = [];
      for (let d = 0; d < dim; d++) {
        if (i === 0 || i === n - 1) { m.push(0); continue; }
        const a = seq[i - 1][d], b = seq[i][d], c = seq[i + 1][d];
        if ((b - a) * (c - b) <= 0) { m.push(0); continue; }
        const slope = (c - a) / (t[i + 1] - t[i - 1]);
        const s0 = (b - a) / (t[i] - t[i - 1]), s1 = (c - b) / (t[i + 1] - t[i]);
        const lim = 3 * Math.min(Math.abs(s0), Math.abs(s1));
        m.push(Math.max(-lim, Math.min(lim, slope)));
      }
      out.push(m);
    }
    return out;
  }
  segment(t) {
    t = Math.max(0, Math.min(t, this.total));
    const n = this.times.length;
    for (let i = 0; i < n - 1; i++) {
      if (t <= this.times[i + 1] || i === n - 2) {
        const h = this.times[i + 1] - this.times[i];
        return [i, h > 0 ? (t - this.times[i]) / h : 1];
      }
    }
    return [n - 2, 1];
  }
  poseAt(t) {
    const [i, u] = this.segment(t);
    const h = this.times[i + 1] - this.times[i];
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const out = {};
    for (const ch of this.channels) {
      const p0 = this.vals[ch][i], p1 = this.vals[ch][i + 1];
      const m0 = this.tangents[ch][i], m1 = this.tangents[ch][i + 1];
      const v = p0.map((_, d) => h00 * p0[d] + h10 * h * m0[d] + h01 * p1[d] + h11 * h * m1[d]);
      out[ch] = this.dims[ch] === 3 ? v : v[0];
    }
    return out;
  }
}
