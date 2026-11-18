// Small 3D math kit matching Ursina/Panda conventions exactly.
// Coordinates: left-handed, +X right, +Y up, +Z forward (same as Babylon.js).
// Matrices are row-vector style, laid out like Babylon's Matrix.m:
//   v' = v * M, translation in m[12..14]. world = local * parentWorld.

export const DEG = Math.PI / 180;

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(b) { return new V3(this.x + b.x, this.y + b.y, this.z + b.z); }
  sub(b) { return new V3(this.x - b.x, this.y - b.y, this.z - b.z); }
  mul(s) { return new V3(this.x * s, this.y * s, this.z * s); }
  dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z; }
  cross(b) { return new V3(this.y * b.z - this.z * b.y, this.z * b.x - this.x * b.z, this.x * b.y - this.y * b.x); }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len() || 1; return new V3(this.x / l, this.y / l, this.z / l); }
  lerp(b, t) { return new V3(this.x + (b.x - this.x) * t, this.y + (b.y - this.y) * t, this.z + (b.z - this.z) * t); }
}
export const v3 = (x, y, z) => new V3(x, y, z);

// Rotation as Ursina applies Entity.rotation = (rx, ry, rz) in degrees.
// Rows are the images of the local x, y, z axes (right, up, forward).
export function rotRows(rx, ry, rz) {
  const X = rotX(rx), Y = rotY(ry), Z = rotZ(rz);
  return mul3(mul3(Z, X), Y); // roll, then pitch, then heading (verified against Ursina)
}
function rotX(a) { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [1, 0, 0, 0, c, s, 0, -s, c]; }
function rotY(a) { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
function rotZ(a) { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mul3(A, B) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
}

// 4x4 (Float64Array(16)), row-vector convention.
export function compose(pos, rot, scale) {
  const R = rotRows(rot[0], rot[1], rot[2]);
  const sx = scale[0], sy = scale[1], sz = scale[2];
  const m = new Float64Array(16);
  m[0] = R[0] * sx; m[1] = R[1] * sx; m[2] = R[2] * sx;
  m[4] = R[3] * sy; m[5] = R[4] * sy; m[6] = R[5] * sy;
  m[8] = R[6] * sz; m[9] = R[7] * sz; m[10] = R[8] * sz;
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
  return m;
}
export function mul4(A, B) {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += A[i * 4 + k] * B[k * 4 + j];
    r[i * 4 + j] = s;
  }
  return r;
}
export function xformPoint(M, p) {
  return new V3(p.x * M[0] + p.y * M[4] + p.z * M[8] + M[12],
                p.x * M[1] + p.y * M[5] + p.z * M[9] + M[13],
                p.x * M[2] + p.y * M[6] + p.z * M[10] + M[14]);
}
export function xformDir(M, d) {
  return new V3(d.x * M[0] + d.y * M[4] + d.z * M[8],
                d.x * M[1] + d.y * M[5] + d.z * M[9],
                d.x * M[2] + d.y * M[6] + d.z * M[10]);
}
export function invertRigid(M) {
  // inverse of a rotation(+uniform-free)+translation matrix with possible scale: general 4x4 inverse
  const m = M, inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

// Scene-graph node with Ursina semantics (position / rotation / scale relative to parent).
export class Node {
  constructor(name, parent = null, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    this.name = name; this.parent = parent; this.pos = pos.slice(); this.rot = rot.slice(); this.scale = scale.slice();
    this.children = []; if (parent) parent.children.push(this);
    this._world = null; this._ver = -1;
  }
  local() { return compose(this.pos, this.rot, this.scale); }
  world() {
    // recomputed on demand (cheap enough for a ~60-node skeleton); cache per global stamp
    if (this._ver === Node.stamp) return this._world;
    const L = this.local();
    this._world = this.parent ? mul4(L, this.parent.world()) : L;
    this._ver = Node.stamp;
    return this._world;
  }
  worldPos() { const w = this.world(); return new V3(w[12], w[13], w[14]); }
  setRot(x, y, z) { this.rot[0] = x; this.rot[1] = y; this.rot[2] = z; Node.dirty(); }
  setPos(x, y, z) { this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; Node.dirty(); }
  // point given in another node's local space -> this node's local space
  relPoint(other, p = new V3()) { return xformPoint(invertRigid(this.world()), xformPoint(other.world(), p)); }
}
Node.stamp = 0;
Node.dirty = () => { Node.stamp++; };
