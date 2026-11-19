import test from 'node:test';
import assert from 'node:assert/strict';
import { lathe, capsuleProfile, uvSphere, torus, BoxBuilder } from '../src/geometry.js';

/** A mesh must have matching attribute counts, in-range indices, finite numbers and unit normals. */
function assertValidMesh(m, name) {
  const verts = m.positions.length / 3;
  assert.ok(Number.isInteger(verts) && verts > 0, `${name}: has vertices`);
  assert.equal(m.normals.length / 3, verts, `${name}: one normal per vertex`);
  assert.equal(m.uvs.length / 2, verts, `${name}: one uv per vertex`);
  assert.equal(m.indices.length % 3, 0, `${name}: whole triangles`);
  assert.ok(m.indices.every((i) => Number.isInteger(i) && i >= 0 && i < verts), `${name}: indices in range`);
  assert.ok(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite) && m.uvs.every(Number.isFinite), `${name}: finite values`);
  for (let i = 0; i < m.normals.length; i += 3) {
    const len = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-6, `${name}: normal ${i / 3} has length ${len}`);
  }
}

test('lathe builds a valid mesh with the expected vertex and triangle counts', () => {
  const m = lathe([[0, 0.1], [1, 0.2], [2, 0.1]], 8);
  assertValidMesh(m, 'lathe');
  assert.equal(m.positions.length / 3, 3 * 9, '3 profile rows x (segments + 1) vertices');
  assert.equal(m.indices.length / 3, 2 * 8 * 2, '2 bands x 8 segments x 2 triangles');
});

test('uvSphere puts every vertex on the sphere', () => {
  const m = uvSphere(0.5, 12, 16);
  assertValidMesh(m, 'uvSphere');
  for (let i = 0; i < m.positions.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]) - 0.5) < 1e-9);
  }
});

test('torus has the right major and minor radii', () => {
  const R = 0.2, r = 0.02, m = torus(R, r, 16, 8);
  assertValidMesh(m, 'torus');
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    const tube = Math.hypot(Math.hypot(x, z) - R, y);       // distance from the ring's centre line
    assert.ok(Math.abs(tube - r) < 1e-6, `vertex ${i / 3} is ${tube} from the centre line, expected ${r}`);
  }
});

test('capsule profiles lathe into valid meshes and span the requested length', () => {
  const profile = capsuleProfile(1, 0.1, 0.05);
  const ys = profile.map((p) => p[0]);
  assert.ok(profile.every(([y, r]) => Number.isFinite(y) && Number.isFinite(r) && r >= 0));
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 1, 'spans at least the shaft length (plus end caps)');
  assertValidMesh(lathe(profile, 8), 'capsule');
});

test('lathe scales x and z independently (used for elliptical limbs)', () => {
  const m = lathe([[0, 1], [1, 1]], 4, 2, 0.5);
  const xs = [], zs = [];
  for (let i = 0; i < m.positions.length; i += 3) { xs.push(Math.abs(m.positions[i])); zs.push(Math.abs(m.positions[i + 2])); }
  assert.ok(Math.abs(Math.max(...xs) - 2) < 1e-9);
  assert.ok(Math.abs(Math.max(...zs) - 0.5) < 1e-9);
});

test('BoxBuilder makes boxes of the requested size, merges several, and can rotate them', () => {
  const extent = (m, axis) => { const v = []; for (let i = axis; i < m.positions.length; i += 3) v.push(m.positions[i]); return Math.max(...v) - Math.min(...v); };
  const b = new BoxBuilder();
  b.box([0, 0, 0], [1, 2, 3], [1, 0, 0]);
  const one = b.build();
  assert.equal(one.positions.length / 3, 24, '6 faces x 4 vertices');
  assert.equal(one.indices.length, 36, '12 triangles');
  assert.ok(Math.abs(extent(one, 0) - 1) < 1e-9 && Math.abs(extent(one, 1) - 2) < 1e-9 && Math.abs(extent(one, 2) - 3) < 1e-9, 'extents equal the size');
  b.box([5, 0, 0], [1, 1, 1], [0, 1, 0], Math.PI / 2);
  const two = b.build();
  assert.equal(two.positions.length / 3, 48);
  assert.ok(two.indices.every((i) => i >= 0 && i < 48));
  assert.equal(two.colors.length / 4 === 48 || two.colors.length / 3 === 48, true, 'one colour per vertex');
});
