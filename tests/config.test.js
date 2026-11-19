import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/config.js';

test('FIBA court and hoop dimensions', () => {
  assert.equal(C.COURT_LENGTH, 28);
  assert.equal(C.COURT_WIDTH, 15);
  assert.equal(C.RIM_HEIGHT_REGULATION, 3.05);
  assert.equal(C.BACKBOARD_W, 1.8);
  assert.equal(C.BACKBOARD_H, 1.05);
  assert.ok(Math.abs(2 * C.RIM_INNER_R - 0.45) < 1e-9, 'rim inner diameter is 45 cm');
});

test('the basket is 4.225 m from the free-throw line (5.80 m - 1.575 m from the baseline)', () => {
  assert.ok(Math.abs(C.basketZ() - C.ftLineZ() - 4.225) < 1e-9);
  assert.ok(Math.abs(C.basketZ() - 12.425) < 1e-9);
});

test('ball radii grow with ball size, and unknown sizes fall back to size 6', () => {
  assert.ok(C.BALL_RADII[5] < C.BALL_RADII[6] && C.BALL_RADII[6] < C.BALL_RADII[7]);
  assert.equal(C.ballRadius({ ball_size: 7 }), C.BALL_RADII[7]);
  assert.equal(C.ballRadius({ ball_size: 99 }), C.BALL_RADII[6]);
  // size 7 is about 75 cm round, size 6 about 72.4 cm, size 5 about 69 cm
  assert.ok(Math.abs(2 * Math.PI * C.BALL_RADII[7] - 0.75) < 0.01);
});

test('default settings are valid and a fresh object each time', () => {
  const s = C.defaultSettings();
  assert.equal(s.handedness, 'right');
  assert.equal(s.skill, 'shooting');
  assert.ok(s.player_height > 1 && s.player_height < 2.2);
  assert.ok([5, 6, 7].includes(s.ball_size));
  for (const k of ['jersey_color', 'trim_color', 'skin_color', 'hair_color']) {
    assert.equal(s[k].length, 3);
    assert.ok(s[k].every((v) => v >= 0 && v <= 1), `${k} is an RGB triple in 0..1`);
  }
  s.player_height = 9;
  assert.notEqual(C.defaultSettings().player_height, 9, 'mutating one result must not leak into the next');
});
