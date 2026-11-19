import test from 'node:test';
import assert from 'node:assert/strict';
import { V3, DEG, rotRows, compose, mul4, invertRigid, xformPoint, xformDir, Node } from '../src/math.js';

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} != ${b}`);

test('V3 arithmetic', () => {
  const a = new V3(1, 2, 3), b = new V3(-4, 5, 0.5);
  assert.deepEqual(a.add(b), new V3(-3, 7, 3.5));
  assert.deepEqual(a.sub(b), new V3(5, -3, 2.5));
  assert.deepEqual(a.mul(2), new V3(2, 4, 6));
  close(a.dot(b), -4 + 10 + 1.5);
  close(new V3(3, 4, 0).len(), 5);
  close(a.norm().len(), 1);
  assert.deepEqual(new V3().norm(), new V3(), 'normalising the zero vector must not produce NaN');
  assert.deepEqual(a.lerp(b, 0), a);
  assert.deepEqual(a.lerp(b, 1), b);
});

test('V3 cross product is perpendicular and follows the right-hand rule on x, y', () => {
  const a = new V3(1, 2, 3), b = new V3(-4, 5, 0.5), c = a.cross(b);
  close(c.dot(a), 0);
  close(c.dot(b), 0);
  assert.deepEqual(new V3(1, 0, 0).cross(new V3(0, 1, 0)), new V3(0, 0, 1));
});

test('V3 clone is independent of the original', () => {
  const a = new V3(1, 2, 3), b = a.clone();
  b.x = 99;
  assert.equal(a.x, 1);
});

test('rotRows gives orthonormal rows with determinant +1 for any angles', () => {
  for (const [rx, ry, rz] of [[0, 0, 0], [30, 0, 0], [0, 90, 0], [10, -45, 70], [-120, 33, 200]]) {
    const R = rotRows(rx, ry, rz);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const dot = R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2];
      close(dot, i === j ? 1 : 0, 1e-12, `rows ${i},${j} for (${rx},${ry},${rz})`);
    }
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    close(det, 1, 1e-12);
  }
});

test('a heading rotation turns forward (+Z) towards +X (left-handed, y up)', () => {
  const p = xformDir(compose([0, 0, 0], [0, 90, 0], [1, 1, 1]), new V3(0, 0, 1));
  close(p.x, 1, 1e-12);
  close(p.z, 0, 1e-12);
});

test('compose, xformPoint and invertRigid round-trip a point', () => {
  const M = compose([1, 2, 3], [20, -35, 50], [1, 1, 1]);
  const p = new V3(0.3, -1.2, 4);
  const q = xformPoint(invertRigid(M), xformPoint(M, p));
  close(q.x, p.x, 1e-9); close(q.y, p.y, 1e-9); close(q.z, p.z, 1e-9);
});

test('invertRigid handles non-uniform scale', () => {
  const M = compose([0, 1, 0], [10, 20, 30], [2, 0.5, 3]);
  const I = mul4(M, invertRigid(M));
  for (let i = 0; i < 16; i++) close(I[i], i % 5 === 0 ? 1 : 0, 1e-9, `identity element ${i}`);
});

test('Node world transforms follow the parent chain', () => {
  const root = new Node('root', null, [0, 1, 0]);
  const arm = new Node('arm', root, [0, 0, 2]);
  const hand = new Node('hand', arm, [0, 0, 1]);
  let p = hand.worldPos();
  close(p.y, 1); close(p.z, 3);
  root.setRot(0, 90, 0);                            // turn the whole chain to face +X
  p = hand.worldPos();
  close(p.x, 3, 1e-9); close(p.z, 0, 1e-9); close(p.y, 1);
});

test('Node.relPoint converts between two nodes\' local spaces', () => {
  const a = new Node('a', null, [1, 0, 0]);
  const b = new Node('b', null, [0, 0, 5]);
  const p = a.relPoint(b, new V3(0, 0, 0));          // b's origin, seen from a
  close(p.x, -1); close(p.z, 5);
});

test('DEG converts degrees to radians', () => close(180 * DEG, Math.PI));
