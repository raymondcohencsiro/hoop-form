// Left-handed shooters are produced by mirroring poses and text. The result must be an exact
// mirror image of the right-handed shooter, and the text must swap left and right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, SKILL_KEYS, sharedCore, dist } from './helpers.js';
import { mirrorText } from '../src/metrics.js';
import { V3 } from '../src/math.js';

const flipX = (v) => new V3(-v.x, v.y, v.z);
const PAIRS = [['shoulder_R', 'shoulder_L'], ['elbow_R', 'elbow_L'], ['wrist_R', 'wrist_L'], ['hip_R', 'hip_L'],
  ['knee_R', 'knee_L'], ['ankle_R', 'ankle_L'], ['toe_R', 'toe_L'], ['heel_R', 'heel_L']];
const CENTRE = ['pelvis', 'neck', 'eye'];

// The off-hand ("guide") arm is solved by damped-least-squares IK. Its finite-difference steps are
// mirrored for a left-handed player, so that solve is an exact mirror of the right-handed one as well.
const GUIDE = { right: ['elbow_L', 'wrist_L', 'fingertip_L'], left: ['elbow_R', 'wrist_R', 'fingertip_R'] };
const mirrorName = (n) => (/_[RL]$/.test(n) ? n.slice(0, -2) + (n.endsWith('_R') ? '_L' : '_R') : n);

// Mirror errors are measured once per skill (a full playback of both players) and shared by the tests below.
const errors = new Map();
function mirrorErrors(key) {
  if (errors.has(key)) return errors.get(key);
  const R = sharedCore(key), L = sharedCore(key, { handedness: 'left' });
  const guide = new Set(GUIDE.right);
  const strictJoints = [...PAIRS.flat(), ...CENTRE].filter((j) => !guide.has(j) && !guide.has(mirrorName(j)));
  const out = { strict: 0, guide: 0 };
  for (let t = 0; t <= R.timeline.total; t += 0.04) {
    R.seek(t); L.seek(t);
    for (const j of strictJoints) out.strict = Math.max(out.strict, dist(flipX(R.avatar.world(j)), L.avatar.world(mirrorName(j))));
    out.strict = Math.max(out.strict, dist(flipX(R.ballPos), L.ballPos));
    for (const j of GUIDE.right) out.guide = Math.max(out.guide, dist(flipX(R.avatar.world(j)), L.avatar.world(mirrorName(j))));
  }
  errors.set(key, out);
  return out;
}

for (const key of SKILL_KEYS) {
  test(`${key}: a left-handed player mirrors a right-handed one to within 1 mm (everything except the guide arm)`, () => {
    const { strict } = mirrorErrors(key);
    assert.ok(strict < 0.001, `worst mirror error ${(strict * 1000).toFixed(2)} mm`);
  });

  test(`${key}: the guide arm is an exact mirror (1 mm)`, () => {
    const { guide } = mirrorErrors(key);
    assert.ok(guide < 0.001, `guide arm is ${(guide * 1000).toFixed(1)} mm from a perfect mirror`);
  });

  test(`${key}: both hands give the same shot numbers and the same checkpoint results`, () => {
    const R = sharedCore(key), L = sharedCore(key, { handedness: 'left' });
    for (const f of ['release_angle', 'release_elbow', 'entry_angle', 't_through', 'flight_duration']) {
      assert.ok(Math.abs(R.ball[f] - L.ball[f]) < 1e-3, `${f}: ${R.ball[f]} vs ${L.ball[f]}`);
    }
    assert.ok(Math.abs(R.end_time - L.end_time) < 1e-9);
    R.skill.phases.forEach((phase, i) => {
      const t = R.timeline.times[i + 1] - 1e-3;
      R.seek(t); L.seek(t);
      R.checks(phase).forEach((r, k) => {
        const l = L.checks(phase)[k];
        assert.equal(l.ok, r.ok, `${phase.key}/${r.label}`);
        if (r.value != null) assert.ok(Math.abs(l.value - r.value) < 0.05, `${phase.key}/${r.label}: ${r.value} vs ${l.value}`);
      });
    });
  });

  test(`${key}: the shooter's side flips with handedness`, () => {
    assert.equal(sharedCore(key).avatar.side, 'R');
    assert.equal(sharedCore(key, { handedness: 'left' }).avatar.side, 'L');
  });
}

test('mirrorText swaps left and right in every case', () => {
  const skill = { name: 'Left-hand drill', summary: 'Right foot, LEFT hand', mnemonic: 'Left or Right', phases: [{
    title: 'Right wing', why: 'Use your left hand, not the right.', cues: ['Left elbow in'], faults: ['LEFT foot late → RIGHT first'], drill: 'Switch right and left' }] };
  const m = mirrorText(skill);
  assert.equal(m.name, 'Right-hand drill');
  assert.equal(m.summary, 'Left foot, RIGHT hand');
  assert.equal(m.mnemonic, 'Right or Left');
  assert.equal(m.phases[0].title, 'Left wing');
  assert.equal(m.phases[0].why, 'Use your right hand, not the left.');
  assert.deepEqual(m.phases[0].cues, ['Right elbow in']);
  assert.deepEqual(m.phases[0].faults, ['RIGHT foot late → LEFT first']);
  assert.equal(m.phases[0].drill, 'Switch left and right');
});

test('mirrorText does not touch words that merely contain "left" or "right"', () => {
  const m = mirrorText({ name: 'Copyright, leftover, straight, upright', summary: '', mnemonic: '', phases: [] });
  assert.equal(m.name, 'Copyright, leftover, straight, upright');
});

test('mirrorText is its own inverse on the real coaching text, and does not alter the original', () => {
  for (const skill of SKILLS.skills) {
    const before = JSON.stringify(skill);
    const once = mirrorText(skill);
    assert.equal(JSON.stringify(skill), before, 'the input must not be mutated');
    assert.deepEqual(mirrorText(once), JSON.parse(before));
  }
});

test('mirrorText turns every "left" into "right" and vice versa, and changes nothing else', () => {
  const count = (obj, re) => (JSON.stringify(obj).match(re) || []).length;
  for (const skill of SKILLS.skills) {
    const once = mirrorText(skill);
    assert.equal(count(once, /\bleft\b/gi), count(skill, /\bright\b/gi), `${skill.key}: lefts after = rights before`);
    assert.equal(count(once, /\bright\b/gi), count(skill, /\bleft\b/gi), `${skill.key}: rights after = lefts before`);
    assert.deepEqual(once.phases.map((p) => p.duration), skill.phases.map((p) => p.duration), 'timings are untouched');
    assert.deepEqual(once.phases.map((p) => p.checks), skill.phases.map((p) => p.checks), 'checkpoint ranges are untouched');
  }
});

test('a left-handed player sees the mirrored text, a right-handed player the authored text', () => {
  for (const key of SKILL_KEYS) {
    const R = sharedCore(key), L = sharedCore(key, { handedness: 'left' });
    assert.equal(R.display_skill, R.skill, 'right-handed players see the authored text');
    assert.deepEqual(JSON.parse(JSON.stringify(L.display_skill)), JSON.parse(JSON.stringify(mirrorText(L.skill))));
  }
  const layup = [sharedCore('layup'), sharedCore('layup', { handedness: 'left' })];
  assert.notEqual(JSON.stringify(layup[0].display_skill), JSON.stringify(layup[1].display_skill), 'the layup text mentions a side, so it must differ');
});
