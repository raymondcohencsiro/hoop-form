import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS } from './helpers.js';
import { Timeline, mirrorPose } from '../src/animation.js';

const flat = (v) => (Array.isArray(v) ? v : [v]);

for (const skill of SKILLS.skills) {
  test(`${skill.key}: phase times add up and release time is inside the release phase`, () => {
    const tl = new Timeline(skill);
    const sum = skill.phases.reduce((s, p) => s + p.duration, 0);
    assert.ok(Math.abs(tl.total - sum) < 1e-9);
    assert.equal(tl.times.length, skill.phases.length + 1);
    for (let i = 1; i < tl.times.length; i++) assert.ok(tl.times[i] > tl.times[i - 1]);
    const i = skill.phases.findIndex((p) => p.key === skill.release_phase);
    const lo = tl.times[i] + Math.min(0, skill.phases[i].duration * skill.release_fraction);
    assert.ok(Math.abs(tl.release_time - (tl.times[i] + skill.phases[i].duration * skill.release_fraction)) < 1e-9);
    assert.ok(tl.release_time >= lo - 1e-9 && tl.release_time <= tl.total);
  });

  test(`${skill.key}: the pose passes exactly through every key pose`, () => {
    const tl = new Timeline(skill);
    tl.keys.forEach((key, i) => {
      const pose = tl.poseAt(tl.times[i]);
      for (const ch of tl.channels) {
        const want = ch in key ? flat(key[ch]) : new Array(tl.dims[ch]).fill(0);
        flat(pose[ch]).forEach((v, d) => assert.ok(Math.abs(v - want[d]) < 1e-6, `${ch}[${d}] at key ${i}: ${v} != ${want[d]}`));
      }
    });
  });

  test(`${skill.key}: monotone interpolation never overshoots between keys`, () => {
    const tl = new Timeline(skill);
    for (let i = 0; i < tl.times.length - 1; i++) {
      for (const ch of tl.channels) {
        for (let d = 0; d < tl.dims[ch]; d++) {
          const a = tl.vals[ch][i][d], b = tl.vals[ch][i + 1][d], lo = Math.min(a, b) - 1e-6, hi = Math.max(a, b) + 1e-6;
          for (let u = 0; u <= 1; u += 0.05) {
            const t = tl.times[i] + u * (tl.times[i + 1] - tl.times[i]);
            const v = flat(tl.poseAt(t)[ch])[d];
            assert.ok(v >= lo && v <= hi, `${ch}[${d}] = ${v} leaves [${a}, ${b}] in segment ${i}`);
          }
        }
      }
    }
  });

  test(`${skill.key}: poses are finite everywhere and clamp outside the timeline`, () => {
    const tl = new Timeline(skill);
    for (let t = -1; t <= tl.total + 1; t += 0.037) {
      for (const [ch, v] of Object.entries(tl.poseAt(t))) assert.ok(flat(v).every(Number.isFinite), `${ch} at t=${t}`);
    }
    assert.deepEqual(tl.poseAt(-5), tl.poseAt(0));
    assert.deepEqual(tl.poseAt(tl.total + 5), tl.poseAt(tl.total));
  });
}

test('mirrorPose swaps _R/_L channels and flips yaw/roll, and is its own inverse', () => {
  const pose = { shoulder_R: [-22, 5, 10], shoulder_L: [-30, 0, 8], root_yaw: -7, air: 0.2, knee_R: 8, chest: [0, 4, 0] };
  const m = mirrorPose(pose);
  assert.deepEqual(m.shoulder_L, [-22, -5, -10]);
  assert.deepEqual(m.shoulder_R, [-30, -0, -8]);
  assert.equal(m.root_yaw, 7);
  assert.equal(m.air, 0.2);
  assert.equal(m.knee_L, 8);
  assert.ok(!('knee_R' in m));
  assert.deepEqual(mirrorPose(mirrorPose(pose)), pose);
});

test('mirrorPose is its own inverse for every real pose', () => {
  for (const skill of SKILLS.skills) for (const p of [skill.rest_pose, ...skill.phases.map((x) => x.pose)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(mirrorPose(mirrorPose(p)))), JSON.parse(JSON.stringify(p)));
  }
});

test('a left-handed timeline is the mirror image of the right-handed one', () => {
  for (const skill of SKILLS.skills) {
    const R = new Timeline(skill), L = new Timeline(skill, true);
    assert.equal(L.total, R.total);
    for (let t = 0; t <= R.total; t += 0.1) {
      const r = R.poseAt(t), l = L.poseAt(t), m = mirrorPose(r);
      for (const ch of Object.keys(m)) {
        flat(m[ch]).forEach((v, d) => assert.ok(Math.abs(v - flat(l[ch])[d]) < 1e-6, `${skill.key} ${ch} at t=${t.toFixed(2)}`));
      }
    }
  }
});
