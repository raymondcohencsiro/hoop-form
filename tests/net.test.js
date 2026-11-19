import test from 'node:test';
import assert from 'node:assert/strict';
import { NetSim } from '../src/net.js';

const make = () => new NetSim({ rTop: 0.229, rBottom: 0.112, length: 0.42 });
const deviation = (net) => { let m = 0; for (let i = 0; i < net.P.length; i++) m = Math.max(m, Math.abs(net.P[i] - net.R[i])); return m; };
const finite = (net) => [...net.P].every(Number.isFinite);
const DT = 1 / 60, R_BALL = 0.1153;

test('the net hangs at rest with the documented 9 x 24 knots', () => {
  const net = make();
  assert.equal(net.rows, 9);
  assert.equal(net.cols, 24);
  assert.equal(net.n, 216);
  assert.equal(deviation(net), 0);
  assert.ok(net.C.length > 500, 'rings, verticals and diamond cords are all present');
});

test('the net keeps its shape with no ball (no sagging, drifting or exploding)', () => {
  const net = make();
  for (let i = 0; i < 300; i++) net.step(DT, null, R_BALL);
  assert.ok(finite(net));
  assert.ok(deviation(net) < 0.005, `drifted ${(deviation(net) * 1000).toFixed(1)} mm`);
});

test('the top row stays tied to the ring hooks', () => {
  const net = make();
  let y = 0.2;
  for (let i = 0; i < 60; i++) { y -= 5 * DT; net.step(DT, { x: 0, y, z: 0 }, R_BALL); }
  for (let k = 0; k < 3 * net.cols; k++) assert.equal(net.P[k], net.R[k]);
});

test('a ball dropping through pushes the net aside, then the net settles back', () => {
  const net = make();
  let y = 0.2, peak = 0;
  for (let i = 0; i < 60; i++) {
    y -= 5 * DT;
    net.step(DT, { x: 0, y, z: 0 }, R_BALL);
    peak = Math.max(peak, deviation(net));
    assert.ok(finite(net), `NaN while the ball passes (frame ${i})`);
  }
  assert.ok(peak > 0.005, `the net barely reacts to the ball (${(peak * 1000).toFixed(1)} mm)`);
  assert.ok(peak < 0.3, `the net is thrown ${peak.toFixed(2)} m out of shape`);
  for (let i = 0; i < 240; i++) net.step(DT, null, R_BALL);
  assert.ok(deviation(net) < 0.005, `the net has not settled after 4 s (${(deviation(net) * 1000).toFixed(1)} mm off)`);
});

test('a jump in time (seeking) resets the net to rest', () => {
  const net = make();
  let y = 0.2;
  for (let i = 0; i < 20; i++) { y -= 5 * DT; net.step(DT, { x: 0, y, z: 0 }, R_BALL); }
  assert.ok(deviation(net) > 0);
  net.step(0.5, null, R_BALL);
  assert.equal(deviation(net), 0);
});

test('reset() restores the rest shape and zero or negative time steps do nothing', () => {
  const net = make();
  net.step(DT, { x: 0, y: -0.1, z: 0 }, R_BALL);
  net.reset();
  assert.equal(deviation(net), 0);
  const before = Float32Array.from(net.P);
  net.step(0, null, R_BALL); net.step(-1, null, R_BALL); net.step(NaN, null, R_BALL);
  assert.deepEqual(net.P, before);
});
