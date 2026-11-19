// Shot outcomes: every skill must still put the ball through the hoop at a sensible angle,
// for the default player and across the range of player heights, rim heights and ball sizes
// the settings panel allows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_KEYS, HANDS, makeCore, sharedCore, dist } from './helpers.js';
import { RIM_INNER_R } from '../src/config.js';

// The app's own "acceptable" entry band for a set shot (see README, "Shot readout").
const BAND = [38, 52];

for (const key of SKILL_KEYS) for (const hand of HANDS) {
  test(`${key} (${hand}-handed): the default player scores`, () => {
    const c = sharedCore(key, { handedness: hand }), b = c.ball;
    assert.notEqual(b.t_through, null, 'the ball must pass through the hoop');
    assert.ok(b.t_through > 0 && b.t_through < b.flight_duration, 'through-time is inside the flight');
    assert.ok(Number.isFinite(b.entry_angle) && Number.isFinite(b.release_angle));
    if (key === 'layup') {
      assert.ok(b.bank_point, 'the layup is a bank shot');
      assert.ok(b.entry_angle > 40 && b.entry_angle < 75, `layup entry angle ${b.entry_angle.toFixed(1)}`);
    } else {
      assert.ok(!b.bank_point, 'set shots go straight in');
      assert.ok(b.entry_angle >= BAND[0] && b.entry_angle <= BAND[1], `entry angle ${b.entry_angle.toFixed(1)} outside ${BAND}`);
    }
  });

  test(`${key} (${hand}-handed): a clean swish, the ball clears the rim without touching it`, () => {
    const c = sharedCore(key, { handedness: hand }), b = c.ball;
    const horizontal = Math.hypot(b.entry_pos.x - c.rim.x, b.entry_pos.z - c.rim.z);
    const limit = RIM_INNER_R - b.r;     // beyond this the ball would touch the ring
    assert.ok(horizontal < limit, `ball centre is ${horizontal.toFixed(3)} m from the ring centre, limit ${limit.toFixed(3)}`);
    assert.ok(Math.abs(b.entry_pos.y - c.rim.y) < 1e-6, 'entry is recorded at rim height');
  });
}

test('the release happens at the planned time and the ball is not "released" before it', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key), rt = c.timeline.release_time;
    c.seek(rt - 0.02); assert.equal(c.ball.released, false, `${key}: before release`);
    c.seek(rt + 0.02); assert.equal(c.ball.released, true, `${key}: after release`);
  }
});

test('the flight is close to ballistic: apex height matches the launch velocity', () => {
  for (const key of SKILL_KEYS.filter((k) => k !== 'layup')) {     // the layup banks off the glass, so skip it
    const c = sharedCore(key), b = c.ball, p0 = b.sample(0)[0];
    const expected = p0.y + (b.v0.y ** 2) / (2 * 9.81);
    assert.ok(Math.abs(b.apex_y - expected) < 0.05, `${key}: apex ${b.apex_y.toFixed(3)} vs ballistic ${expected.toFixed(3)}`);
  }
});

test('the flight samples are finite and start close to the hand at release (no teleport)', () => {
  for (const key of SKILL_KEYS) {
    const c = sharedCore(key), b = c.ball;
    for (const [p, spin] of b.samples) assert.ok([p.x, p.y, p.z, spin].every(Number.isFinite), `${key}: non-finite sample`);
    c.seek(c.timeline.release_time);
    const gap = dist(b.sample(0)[0], c.ballPos);
    assert.ok(gap < 0.03, `${key}: ball starts ${(gap * 100).toFixed(1)} cm from where the hand left it`);
  }
});

// -- sweeps ------------------------------------------------------------------------------
// Heights, rim heights and ball sizes from the settings panel. A very short player at a
// regulation rim, or a very tall one at a low rim, lands a few degrees outside the 38-52
// band (the release point is lower / higher), so the sweep uses a slightly wider window.
// The extremes of each setting (and the middle height) are what break things, so the grid is kept small
// to keep the suite fast. The default ball (size 6) is covered by the default-player tests above.
const HEIGHTS = [1.3, 1.6, 1.95], RIMS = [2.6, 3.05], BALLS = [5, 7];
const SWEEP_WINDOW = [35, 55];

for (const key of SKILL_KEYS) {
  test(`${key}: scores for every player height, rim height and ball size`, () => {
    const failures = [];
    for (const h of HEIGHTS) for (const rim of RIMS) for (const ball of BALLS) {
      const c = makeCore(key, { player_height: h, rim_height: rim, ball_size: ball }), b = c.ball;
      const label = `height ${h}, rim ${rim}, ball ${ball}`;
      if (b.t_through == null) { failures.push(`${label}: missed`); continue; }
      const off = Math.hypot(b.entry_pos.x - c.rim.x, b.entry_pos.z - c.rim.z);
      if (off >= RIM_INNER_R - b.r) failures.push(`${label}: touches the rim (${off.toFixed(3)} m off centre)`);
      if (key !== 'layup' && (b.entry_angle < SWEEP_WINDOW[0] || b.entry_angle > SWEEP_WINDOW[1])) failures.push(`${label}: entry ${b.entry_angle.toFixed(1)}`);
    }
    assert.deepEqual(failures, []);
  });
}
