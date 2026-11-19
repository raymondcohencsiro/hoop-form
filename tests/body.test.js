// Avatar and ball integrity over a whole playback: bones keep their length, feet stay on or
// above the floor, nothing goes NaN, and the ball never jumps. Also checks where the player
// stands for each skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_KEYS, HANDS, sharedCore, sweep, dist } from './helpers.js';
import { ballRadius, defaultSettings } from '../src/config.js';

const BONES = [['shoulder', 'elbow'], ['elbow', 'wrist'], ['hip', 'knee'], ['knee', 'ankle']];
const FRAME = 1 / 60;

// One pass over the whole playback per skill and hand gathers every statistic the tests below check,
// so the (slow) per-frame pose solve runs once instead of three times.
const scans = new Map();
function scan(key, hand) {
  const id = `${key}/${hand}`;
  if (scans.has(id)) return scans.get(id);
  const c = sharedCore(key, { handedness: hand }), r = ballRadius(c.s);
  const len = (side, a, b) => dist(c.avatar.world(`${a}_${side}`), c.avatar.world(`${b}_${side}`));
  c.seek(0);
  const rest = {};
  for (const side of ['R', 'L']) for (const [a, b] of BONES) rest[`${a}_${side}`] = len(side, a, b);
  const out = { boneDrift: 0, lowestBody: Infinity, nonFinite: 0, lowestBall: Infinity, biggestStep: 0, radius: r };
  let prev = null;
  sweep(c.end_time, FRAME, (t) => {
    c.seek(t);
    for (const side of ['R', 'L']) for (const [a, b] of BONES) out.boneDrift = Math.max(out.boneDrift, Math.abs(len(side, a, b) - rest[`${a}_${side}`]));
    out.lowestBody = Math.min(out.lowestBody, c.avatar.lowest());
    for (const n of ['pelvis', 'head', 'wrist_R', 'wrist_L', 'toe_R', 'toe_L']) { const p = c.avatar.world(n); if (![p.x, p.y, p.z].every(Number.isFinite)) out.nonFinite++; }
    if (![c.ballPos.x, c.ballPos.y, c.ballPos.z].every(Number.isFinite)) out.nonFinite++;
    out.lowestBall = Math.min(out.lowestBall, c.ballPos.y);
    if (prev) out.biggestStep = Math.max(out.biggestStep, dist(c.ballPos, prev));
    prev = c.ballPos.clone();
  });
  scans.set(id, out);
  return out;
}

for (const key of SKILL_KEYS) for (const hand of HANDS) {
  test(`${key} (${hand}-handed): limbs keep their length through the whole motion (IK integrity)`, () => {
    const { boneDrift } = scan(key, hand);
    assert.ok(boneDrift < 0.0005, `a limb changed length by ${(boneDrift * 1000).toFixed(2)} mm`);
  });

  test(`${key} (${hand}-handed): feet never sink into the floor and nothing is NaN`, () => {
    const { nonFinite, lowestBody } = scan(key, hand);
    assert.equal(nonFinite, 0, 'non-finite positions found');
    assert.ok(lowestBody > -0.005, `lowest point of the body reached ${(lowestBody * 100).toFixed(2)} cm`);
  });

  test(`${key} (${hand}-handed): the ball never goes through the floor or teleports between frames`, () => {
    const { lowestBall, biggestStep, radius } = scan(key, hand);
    assert.ok(lowestBall >= radius - 0.01, `ball centre dropped to ${lowestBall.toFixed(3)} m, radius ${radius}`);
    assert.ok(biggestStep < 0.3, `ball moved ${biggestStep.toFixed(3)} m in one frame (${(biggestStep / FRAME).toFixed(1)} m/s)`);
  });
}

test('seeking is repeatable: the same time always gives the same pose, in any order', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key);
    const snap = (t) => { c.seek(t); return ['wrist_R', 'wrist_L', 'ankle_R', 'pelvis'].map((n) => c.avatar.world(n)).concat(c.ballPos); };
    const a = snap(1.1); snap(0.3); snap(c.end_time); snap(0);
    const b = snap(1.1);
    a.forEach((p, i) => assert.ok(dist(p, b[i]) < 1e-9, `${key}: joint ${i} changed after seeking elsewhere and back`));
  }
});

test('the player is scaled by the height setting', () => {
  const tall = sharedCore('shooting', { player_height: 1.9 }), small = sharedCore('shooting', { player_height: 1.4 });
  assert.ok(tall.player_eye_height > small.player_eye_height + 0.3);
  assert.ok(tall.player_eye_height < 1.9 && small.player_eye_height < 1.4, 'eyes sit below the top of the head');
  assert.ok(small.player_eye_height > 1.4 * 0.85, 'but not far below it');
});

// -- where the player stands -------------------------------------------------------------
test('free throw: the player stands at the free-throw line (4.2-4.8 m from the basket)', () => {
  const c = sharedCore('shooting');
  const d = Math.hypot(c.spot.x - c.rim.x, c.spot.z - c.rim.z);
  assert.ok(d > 4.2 && d < 4.8, `distance ${d.toFixed(2)} m`);
});

test('three-pointer: the player stands outside the 6.75 m arc', () => {
  const c = sharedCore('three');
  const d = Math.hypot(c.spot.x - c.rim.x, c.spot.z - c.rim.z);
  assert.ok(d >= 6.75, `distance ${d.toFixed(2)} m, arc radius 6.75 m`);
});

test('the layup starts well out and ends up at the basket', () => {
  const c = sharedCore('layup');
  const start = Math.hypot(c.spot.x - c.rim.x, c.spot.z - c.rim.z);
  assert.ok(start > 7, `layup starts only ${start.toFixed(1)} m from the rim`);
  c.seek(c.timeline.release_time);
  const p = c.avatar.world('pelvis');
  assert.ok(Math.hypot(p.x - c.rim.x, p.z - c.rim.z) < 2.5, 'the player is within 2.5 m of the rim at release');
  assert.ok(c.avatar.world('wrist_R').y > 2.0, 'the shooting hand is high at release');
});

test('rim height setting moves the rim and the shot adapts', () => {
  const low = sharedCore('shooting', { rim_height: 2.6 }), reg = sharedCore('shooting');
  assert.equal(low.rim.y, 2.6);
  assert.equal(reg.rim.y, 3.05);
  assert.notEqual(low.ball.release_angle, reg.ball.release_angle);
});

// -- gait (layup run-in) -----------------------------------------------------------------
test('layup gait: starts from rest, speeds up smoothly and stays at a believable running speed', () => {
  const c = sharedCore('layup'), g = c.gait;
  assert.ok(g, 'the layup has a procedural gait');
  assert.equal(g.speed(0), 0, 'starts standing still');
  let prev = 0, maxSpeed = 0, maxJump = 0;
  sweep(c.timeline.total, FRAME, (t) => {
    const v = g.speed(t);
    assert.ok(Number.isFinite(v) && v >= 0, `speed at t=${t.toFixed(2)} is ${v}`);
    maxSpeed = Math.max(maxSpeed, v); maxJump = Math.max(maxJump, Math.abs(v - prev)); prev = v;
  });
  assert.ok(maxSpeed > 2 && maxSpeed < 3.5, `top speed ${maxSpeed.toFixed(2)} m/s`);
  assert.ok(maxJump < 0.2, `speed jumps by ${maxJump.toFixed(2)} m/s in one frame`);
  assert.equal(sharedCore('shooting').gait, null, 'set shots have no gait');
});

test('layup: the run-in documented in the README (about 1 m/s after 0.2 s, 2 m/s by 0.45 s)', () => {
  // The player stands during the first ("start") phase; the times in the README count from the first step.
  const c = sharedCore('layup'), g = c.gait, t0 = c.skill.phases[0].duration;
  assert.equal(g.speed(t0), 0, 'still standing when the run begins');
  assert.ok(Math.abs(g.speed(t0 + 0.2) - 1) < 0.35, `speed 0.2 s into the run: ${g.speed(t0 + 0.2).toFixed(2)}`);
  assert.ok(Math.abs(g.speed(t0 + 0.45) - 2) < 0.35, `speed 0.45 s into the run: ${g.speed(t0 + 0.45).toFixed(2)}`);
});

test('layup: the player moves forward along the run and the feet alternate', () => {
  const c = sharedCore('layup');
  const z = (t) => { c.seek(t); return c.avatar.world('pelvis').z; };
  assert.ok(z(2.0) > z(0.5), 'pelvis advances towards the basket (+Z)');
  assert.ok(z(c.timeline.release_time) > z(2.0));
});

test('ballRadius from settings matches the physics ball', () => {
  for (const size of [5, 6, 7]) assert.equal(sharedCore('shooting', { ball_size: size }).ball.r, ballRadius({ ...defaultSettings(), ball_size: size }));
});
