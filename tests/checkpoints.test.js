// Coaching checkpoints. At the end of every phase the avatar should be in the pose the phase
// teaches, so every checkpoint for that phase must read "in range". (Mid-phase the body is
// still moving, so ranges are only guaranteed at the end of the phase.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_KEYS, HANDS, sharedCore } from './helpers.js';
import { METRICS } from '../src/metrics.js';

for (const key of SKILL_KEYS) for (const hand of HANDS) {
  test(`${key} (${hand}-handed): every checkpoint is in range at the end of its phase`, () => {
    const c = sharedCore(key, { handedness: hand }), tl = c.timeline, problems = [];
    c.skill.phases.forEach((phase, i) => {
      c.seek(tl.times[i + 1] - 1e-3);
      for (const r of c.checks(phase)) {
        if (r.value == null) problems.push(`${phase.key}/${r.label}: no value`);
        else if (!r.ok) problems.push(`${phase.key}/${r.label}: ${r.value.toFixed(1)}${r.unit} outside [${r.lo}, ${r.hi}]`);
      }
    });
    assert.deepEqual(problems, []);
  });
}

test('release metrics match the figures documented in the README', () => {
  // "the ball leaves while the elbow is still opening (about 127 deg on shots and 140 deg on the layup)"
  const expect = { shooting: 127, three: 127, layup: 140 };
  for (const [key, deg] of Object.entries(expect)) {
    const c = sharedCore(key);
    assert.ok(Math.abs(c.ball.release_elbow - deg) < 8, `${key}: release elbow ${c.ball.release_elbow.toFixed(1)}, expected about ${deg}`);
  }
});

test('release angle comes from the skill (or the settings override)', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key);
    assert.ok(Math.abs(c.ball.release_angle - c.skill.release_angle) < 12, `${key}: ${c.ball.release_angle.toFixed(1)} vs authored ${c.skill.release_angle}`);
  }
  const steep = sharedCore('shooting', { release_angle: 60 });
  const flat = sharedCore('shooting', { release_angle: 45 });
  assert.ok(steep.ball.release_angle > flat.ball.release_angle, 'a higher release-angle setting gives a steeper launch');
});

test('metrics that need a released ball return null before the release', () => {
  const c = sharedCore('shooting');
  c.seek(0);
  for (const m of ['release_angle', 'release_elbow', 'release_height', 'entry_angle']) assert.equal(METRICS[m](c.ctx), null, m);
  c.seek(c.timeline.release_time + 0.05);
  assert.ok(Number.isFinite(METRICS.release_angle(c.ctx)));
  assert.equal(METRICS.entry_angle(c.ctx), null, 'no entry angle until the ball reaches the hoop');
  c.seek(c.ball.t_through + c.timeline.release_time + 0.05);
  assert.ok(Number.isFinite(METRICS.entry_angle(c.ctx)));
});

test('joint angle metrics are within human range at every phase end', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key);
    c.skill.phases.forEach((_, i) => {
      c.seek(c.timeline.times[i + 1] - 1e-3);
      for (const m of ['knee', 'hip', 'elbow']) {
        const v = c.metric(m);
        assert.ok(v >= 20 && v <= 185, `${key} phase ${i}: ${m} = ${v.toFixed(1)}`);
      }
    });
  }
});

test('centre of mass stays over the player (between head height and the floor)', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key);
    for (let t = 0; t <= c.timeline.total; t += 0.1) {
      c.seek(t);
      const y = c.ctx.com.y;
      assert.ok(y > 0.4 && y < 2.4, `${key} t=${t.toFixed(1)}: centre of mass at ${y.toFixed(2)} m`);
    }
  }
});
