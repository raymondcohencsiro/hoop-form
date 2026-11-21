import test from 'node:test';
import assert from 'node:assert/strict';
import { V3 } from '../src/math.js';
import { sharedCore } from './helpers.js';
import { STANCHIONS } from '../src/cameras.js';
import { constrainWalk, allSpots, viewSpot, rawSpot, VIEW_SPOTS, COURT_SPOTS, panelLayout, hitTest, panelPose, stickEdge,
  TABS, PANEL_W, PANEL_H, WALK_X, WALK_Z, KEEP_OUT, yawTo, PANEL_M, HELD_PANEL, heldPanelAxes } from '../src/vrmath.js';

const ctxFor = (skill, overrides = {}) => {
  const c = sharedCore(skill, overrides);
  c.seek(0);
  return { focus: c.focus(), rim: c.rim, heading: c.heading, lefty: c.lefty, scale: (overrides.player_height ?? 1.6) / 1.6 };
};
const SKILLS = ['shooting', 'three', 'layup'], HANDS = ['right', 'left'];

test('constrainWalk keeps people on the walkable floor', () => {
  const p = constrainWalk(50, -50);
  assert.equal(p.x, WALK_X); assert.equal(p.z, -WALK_Z);
});

test('constrainWalk pushes people out of the player and the stanchions', () => {
  const player = new V3(1, 0, 2);
  const p = constrainWalk(1.2, 2.1, player);
  assert.ok(Math.hypot(p.x - player.x, p.z - player.z) >= KEEP_OUT - 1e-9);
  for (const [c, r] of STANCHIONS) {
    const q = constrainWalk(c.x, c.z);
    assert.ok(Math.hypot(q.x - c.x, q.z - c.z) >= r - 1e-9);
  }
  const same = constrainWalk(player.x, player.z, player);      // exactly on the player: still gets out
  assert.ok(Math.hypot(same.x - player.x, same.z - player.z) >= KEEP_OUT - 1e-9);
});

test('every spot is a legal standing point for every skill and both hands', () => {
  for (const skill of SKILLS) for (const hand of HANDS) {
    const ctx = ctxFor(skill, { handedness: hand });
    const spots = allSpots(ctx);
    assert.equal(spots.length, VIEW_SPOTS.length + COURT_SPOTS.length);
    for (const s of spots) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw), `${skill}/${hand}/${s.id} finite`);
      assert.ok(Math.abs(s.x) <= WALK_X + 1e-9 && Math.abs(s.z) <= WALK_Z + 1e-9, `${skill}/${hand}/${s.id} on the floor`);
      assert.ok(Math.hypot(s.x - ctx.focus.x, s.z - ctx.focus.z) >= KEEP_OUT - 1e-6, `${skill}/${hand}/${s.id} clear of the player`);
      for (const [c, r] of STANCHIONS) assert.ok(Math.hypot(s.x - c.x, s.z - c.z) >= r - 1e-6, `${skill}/${hand}/${s.id} clear of the stanchion`);
    }
  }
});

test('viewpoints face the player; court spots face the rim', () => {
  const ctx = ctxFor('shooting');
  for (const id of ['coach', 'side', 'front', 'behind', 'hands']) {
    const s = viewSpot(id, ctx), want = yawTo(s, ctx.focus);
    assert.ok(Math.abs(((s.yaw - want + 540) % 360) - 180) < 0.01, `${id} faces the player`);
  }
  for (const id of ['ft', 'three_top', 'three_wing', 'three_corner', 'under']) {
    const s = viewSpot(id, ctx), want = yawTo(s, ctx.rim);
    assert.ok(Math.abs(((s.yaw - want + 540) % 360) - 180) < 0.01, `${id} faces the rim`);
  }
});

test('the hand viewpoints mirror with the shooting hand', () => {
  const r = rawSpot('shoulder', ctxFor('shooting', { handedness: 'right' })), l = rawSpot('shoulder', ctxFor('shooting', { handedness: 'left' }));
  const fr = ctxFor('shooting', { handedness: 'right' }).focus, fl = ctxFor('shooting', { handedness: 'left' }).focus;
  assert.ok(Math.sign(r.x - fr.x) !== Math.sign(l.x - fl.x), 'the over-the-shoulder spot flips to the other side');
});

test('three-point spots sit on the arc and under-basket is under the ring', () => {
  const ctx = ctxFor('three');
  const top = rawSpot('three_top', ctx), wing = rawSpot('three_wing', ctx), under = rawSpot('under', ctx);
  assert.ok(Math.abs(Math.hypot(top.x - ctx.rim.x, top.z - ctx.rim.z) - 6.75) < 1e-6);
  assert.ok(Math.abs(Math.hypot(wing.x - ctx.rim.x, wing.z - ctx.rim.z) - 6.75) < 1e-6);
  assert.ok(Math.abs(under.x - ctx.rim.x) < 1e-6 && Math.abs(under.z - ctx.rim.z) < 1.0);
});

test('the panel layout stays on the panel and its buttons do not overlap', () => {
  for (const [tab] of TABS) {
    const R = panelLayout(tab, ['shooting', 'three', 'layup']);
    const clickable = R;
    for (const r of clickable) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= PANEL_W && r.y + r.h <= PANEL_H, `${tab}/${r.id} inside the texture`);
    for (let i = 0; i < clickable.length; i++) for (let j = i + 1; j < clickable.length; j++) {
      const a = clickable[i], b = clickable[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${tab}: ${a.id} overlaps ${b.id}`);
    }
    assert.equal(new Set(R.map((r) => r.id)).size, R.length, `${tab}: unique ids`);
  }
});

test('hitTest finds the button under a pixel and reports where inside the timeline', () => {
  const R = panelLayout('spots', ['shooting']);
  const play = R.find((r) => r.id === 'play');
  assert.equal(hitTest(R, play.x + 5, play.y + 5).id, 'play');
  assert.equal(hitTest(R, 3, 3), null);
  const tl = R.find((r) => r.id === 'timeline'), h = hitTest(R, tl.x + tl.w / 4, tl.y + 2);
  assert.equal(h.id, 'timeline'); assert.ok(Math.abs(h.u - 0.25) < 1e-9);
  for (const r of R) assert.equal(hitTest(R, r.x + r.w / 2, r.y + r.h / 2).id, r.id, `${r.id} is reachable`);
});

test('the panel floats in front of the head and faces back at it', () => {
  const p = panelPose({ x: 2, y: 1.7, z: -3 }, 0);
  assert.ok(Math.abs(p.x - 2) < 1e-9 && Math.abs(p.z - (-3 + 1.3)) < 1e-9 && p.y < 1.7);
  const q = panelPose({ x: 0, y: 1.6, z: 0 }, 90);
  assert.ok(Math.abs(q.x - 1.3) < 1e-9 && Math.abs(q.z) < 1e-9 && Math.abs(q.yaw - Math.PI / 2) < 1e-9);
  assert.ok(panelPose({ x: 0, y: 0.5, z: 0 }, 0).y >= 0.9, 'never sinks into the floor');
});

test('stickEdge fires once per push and re-arms with hysteresis', () => {
  const st = {};
  assert.equal(stickEdge(st, 0.5), 0);
  assert.equal(stickEdge(st, 0.9), 1);
  assert.equal(stickEdge(st, 1), 0);
  assert.equal(stickEdge(st, 0.5), 0);          // not low enough to re-arm
  assert.equal(stickEdge(st, 0.2), 0);
  assert.equal(stickEdge(st, -0.8), -1);
  assert.equal(stickEdge(st, -0.9), 0);
});

test('held panel: right-handed axes, readable from above and behind the controller, smaller than the world panel', () => {
  const { right, up, front } = heldPanelAxes(), dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  for (const v of [right, up, front]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-9, 'unit length');
  assert.ok(Math.abs(dot(right, up)) < 1e-9 && Math.abs(dot(up, front)) < 1e-9 && Math.abs(dot(right, front)) < 1e-9, 'orthogonal');
  const z = cross(right, up);                                                      // the plane's own +Z is the side you cannot read it from
  assert.ok(Math.abs(z.x + front.x) < 1e-9 && Math.abs(z.y + front.y) < 1e-9 && Math.abs(z.z + front.z) < 1e-9, 'front is -Z of a proper rotation');
  assert.ok(front.y > 0 && front.z < 0, 'faces up and back toward the wearer');
  assert.ok(up.z > 0, 'its top edge points away from the wearer (the way the controller points)');
  assert.ok(HELD_PANEL.w < PANEL_M.w && HELD_PANEL.w > 0.2, 'hand-sized');
});

test('Exit VR is on every tab, and the held panel stays small', () => {
  for (const [tab] of TABS) assert.ok(panelLayout(tab, ['shooting', 'three', 'layup']).some((r) => r.id === 'exit'), `${tab}: has Exit VR`);
  assert.ok(HELD_PANEL.w <= 0.4, 'a small panel on the controller');
});
