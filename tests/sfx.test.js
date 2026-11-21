// Sound effects: when the ball swishes and bounces (the events the app plays), and the synthesized sounds themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_KEYS, HANDS, sharedCore } from './helpers.js';
import { swishSamples, bounceSamples } from '../src/sfxSynth.js';
import { Sfx } from '../src/sfx.js';

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

// ---- the Web Audio player, against a stand-in for the browser's audio API
function fakeAudio({ state = 'running', sampleRate = 48000, bufferFails = false } = {}) {
  const log = { sources: 0, started: 0, panners: 0, resumes: 0, closed: 0 }, param = () => ({ value: 0 });
  class Ctx {
    constructor() { this.state = state; this.sampleRate = sampleRate; this.currentTime = 0; this.destination = {}; this.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() }; }
    createBuffer(ch, n) { if (bufferFails) throw new Error('no buffers'); return { length: n, getChannelData: () => new Float32Array(n) }; }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createBufferSource() { log.sources++; return { buffer: null, playbackRate: param(), connect() {}, disconnect() {}, start() { log.started++; } }; }
    createPanner() { log.panners++; return { positionX: param(), positionY: param(), positionZ: param(), connect() {}, disconnect() {} }; }
    resume() { log.resumes++; this.state = 'running'; return Promise.resolve(); }
    close() { log.closed++; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: Ctx };
  return log;
}
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

test('Sfx: unlock builds the context once; a positioned sound is panned in 3D with z flipped', () => {
  const log = fakeAudio(), s = new Sfx(true);
  assert.equal(s.unlock(), true); const ctx = s.ctx; assert.equal(s.unlock(), true); assert.equal(s.ctx, ctx, 'one context');
  s.play('swish', { x: 1, y: 3, z: 8 }, 1, 1);
  assert.equal(log.started, 1); assert.equal(log.panners, 1);
});

test('Sfx: a suspended (blocked) context stays quiet, says so, and works once the browser lets it start', async () => {
  const log = fakeAudio({ state: 'suspended' }), s = new Sfx(true); let blocked = 0; s.onBlocked = () => blocked++;
  s.ctx = null; s.unlock(); s.ctx.state = 'suspended';
  s.play('bounce', null); assert.equal(log.started, 0); assert.equal(blocked, 1, 'tells the app');
  await Promise.resolve(); s.play('bounce', null); assert.equal(log.started, 1, 'plays after resume');
});

test('Sfx: tick resumes a suspended context and then plays the confirmation', async () => {
  const log = fakeAudio({ state: 'suspended' }), s = new Sfx(true);
  s.tick(); await new Promise((r) => setTimeout(r, 0));
  assert.ok(log.resumes >= 1); assert.equal(log.started, 1);
});

test('Sfx: off means silent and no warnings; the same sound twice within 50 ms plays once', () => {
  const log = fakeAudio(), s = new Sfx(false); let blocked = 0; s.onBlocked = () => blocked++;
  s.unlock(); s.play('swish', null); assert.equal(log.started, 0); assert.equal(blocked, 0);
  s.on = true; s.play('swish', null); s.play('swish', null); assert.equal(log.started, 1);
});

test('Sfx: if the context cannot be built it is not kept, and the next gesture tries again', () => {
  fakeAudio({ bufferFails: true }); const s = new Sfx(true);
  assert.equal(quiet(() => s.unlock()), false); assert.equal(s.ctx, null);
  const log = fakeAudio(); assert.equal(s.unlock(), true); s.play('bounce', null); assert.equal(log.started, 1);
});

test('Sfx: the listener ignores bad numbers, flips z and never gets an up vector parallel to where it looks', () => {
  fakeAudio(); const s = new Sfx(true); s.unlock(); const l = s.ctx.listener;
  s.listen({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 });
  assert.deepEqual([l.positionX.value, l.positionY.value, l.positionZ.value, l.forwardZ.value, l.upY.value], [1, 2, -3, -1, 1]);
  s.listen({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }); assert.equal(l.positionX.value, 1, 'NaN ignored');
  s.listen({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); assert.equal(l.positionX.value, 1, 'zero direction ignored');
  s.listen({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }); assert.deepEqual([l.upY.value, l.upZ.value], [0, 1], 'looking straight down uses another up');
});
