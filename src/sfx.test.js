// Sound effects: when the ball swishes and bounces (the events the app plays), and the synthesized sounds themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_KEYS, HANDS, sharedCore } from './helpers.js';
import { swishSamples, bounceSamples } from '../src/sfxSynth.js';

for (const key of SKILL_KEYS) for (const hand of HANDS) {
  test(`${key} (${hand}-handed): the ball's sounds are in order, finite and inside the skill`, () => {
    const c = sharedCore(key, { handedness: hand }), ev = c.soundEvents(), rt = c.timeline.release_time;
    assert.ok(ev.length > 0);
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      assert.ok(e.kind === 'swish' || e.kind === 'bounce');
      assert.ok(Number.isFinite(e.t) && e.t >= 0, 'time');
      assert.ok(e.gain > 0 && e.gain <= 1, 'gain');
      assert.ok([e.pos.x, e.pos.y, e.pos.z].every(Number.isFinite), 'position');
      if (i) assert.ok(e.t >= ev[i - 1].t, 'sorted');
    }
    const sw = ev.filter((e) => e.kind === 'swish');
    assert.equal(sw.length, 1, 'one swish for a made shot');
    assert.ok(Math.abs(sw[0].t - (rt + c.ball.t_through)) < 1e-9, 'the swish is when the ball passes through the rim');
    assert.ok(Math.hypot(sw[0].pos.x - c.rim.x, sw[0].pos.z - c.rim.z) < 1e-9, 'the swish is at the hoop');
    const after = ev.filter((e) => e.kind === 'bounce' && e.t > sw[0].t);
    assert.ok(after.length >= 1, 'the ball bounces on the floor after going through');
    assert.ok(after.every((e) => e.pos.y > 0 && e.pos.y < 0.2), 'floor bounces happen at ball-radius height');
    assert.ok(after.every((e) => e.t > sw[0].t), 'only after the swish');
    assert.ok(after[0].gain >= after.at(-1).gain, 'each bounce is no louder than the one before');
    assert.equal(ev.filter((e) => e.kind === 'bounce' && e.t < rt).length, (c.skill.dribbles || []).length, 'one bounce per dribble before the shot');
    assert.equal(c.soundEvents(), ev, 'cached');
  });
}

for (const [name, fn, secs] of [['swish', swishSamples, 0.5], ['bounce', bounceSamples, 0.45]]) {
  test(`${name}: a clean, finite sound that dies away`, () => {
    for (const sr of [22050, 44100, 48000]) {
      const d = fn(sr);
      assert.ok(Math.abs(d.length - secs * sr) <= 1, 'length');
      let peak = 0; for (const v of d) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
      assert.ok(peak > 0.85 && peak <= 0.9 + 1e-6, `normalised to 0.9 (got ${peak})`);
      const rms = (a, b) => Math.sqrt(d.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
      assert.ok(rms(0, Math.round(sr * 0.1)) > 4 * rms(d.length - Math.round(sr * 0.1), d.length), 'loud at the start, nearly silent at the end');
      assert.ok(Math.abs(d[d.length - 1]) < 1e-9, 'ends at zero (no click)');
    }
    assert.deepEqual(Array.from(fn(44100).slice(0, 50)), Array.from(fn(44100).slice(0, 50)), 'deterministic');
  });
}

test('the bounce is mostly low frequency and the swish mostly high', () => {
  const sr = 44100, zc = (d) => { let n = 0; for (let i = 1; i < d.length; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++; return n / (d.length / sr) / 2; };   // rough dominant frequency
  const b = bounceSamples(sr), s = swishSamples(sr);
  assert.ok(zc(b) < 1500, `bounce pitch ${Math.round(zc(b))} Hz`);
  assert.ok(zc(s) > 1500, `swish pitch ${Math.round(zc(s))} Hz`);
});
