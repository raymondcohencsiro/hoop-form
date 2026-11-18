// Babylon.js rendering: engine, lights/shadows, arena, avatar, ball, net, overlays.
// All poses come from the headless core as world matrices (Ursina conventions =
// Babylon's left-handed, row-vector conventions, so they are passed through as-is).
/* global BABYLON */
import * as C from './config.js';
import { NetSim } from './net.js';
import { lathe, uvSphere, torus, BoxBuilder } from './geometry.js';
import { compose, mul4, V3 } from './math.js';
import { paintCourt, courtLines } from './court.js';
import { buildStadium } from './stadium.js';

const B = () => window.BABYLON;
export const FLIP_WINDING = new URLSearchParams(location.search).get('flip') === '1';   // Babylon's front faces wind the other way from Ursina's

export async function createEngine(canvas, prefer = 'webgl') {
  // WebGL2 by default: it runs everywhere. WebGPU is opt-in (#webgpu) - if it
  // fails part-way the canvas is replaced, because a canvas that has handed out
  // a WebGPU context can never give a WebGL one.
  const BABYLON = B();
  const opts = { antialias: true, stencil: true, adaptToDeviceRatio: true, powerPreference: 'high-performance' };
  if (prefer === 'webgpu') {
    try {
      if (navigator.gpu && await BABYLON.WebGPUEngine.IsSupportedAsync) {
        const e = new BABYLON.WebGPUEngine(canvas, opts);
        await e.initAsync();
        e.hoopformBackend = 'WebGPU';
        return e;
      }
    } catch (err) { console.warn('WebGPU unavailable, using WebGL2', err); }
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh); canvas = fresh;
  }
  const e = new BABYLON.Engine(canvas, true, opts, true);
  e.hoopformBackend = e.webGLVersion >= 2 ? 'WebGL2' : 'WebGL';
  return e;
}

function vdata(g, flip = FLIP_WINDING) {
  const BABYLON = B(), vd = new BABYLON.VertexData();
  vd.positions = g.positions; vd.normals = g.normals; vd.uvs = g.uvs;
  if (g.colors) vd.colors = g.colors;
  let idx = g.indices;
  if (flip) { idx = idx.slice(); for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } }
  vd.indices = idx;
  return vd;
}
function meshFrom(name, g, scene, mat, opts = {}) {
  const m = new (B().Mesh)(name, scene);
  vdata(g).applyToMesh(m, !!opts.updatable);
  m.material = mat;
  return m;
}
function std(scene, name, rgb, { spec = 0.12, power = 24, emissive = 0, alpha = 1, tex = null, vertexColors = false } = {}) {
  const BABYLON = B(), m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(...rgb);
  m.specularColor = new BABYLON.Color3(spec, spec, spec);
  m.specularPower = power;
  if (emissive) { m.emissiveColor = new BABYLON.Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive); m.disableLighting = emissive >= 1; }
  if (alpha < 1) m.alpha = alpha;
  if (tex) m.diffuseTexture = tex;
  return m;
}
export function textTexture(scene, text, w, h, fg, bg, size, font = 'bold') {
  const t = new (B().DynamicTexture)('txt_' + text.slice(0, 8), { width: w, height: h }, scene, true);
  const ctx = t.getContext();
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = `${font} ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.04);
  t.update();
  t.anisotropicFilteringLevel = 8;
  return t;
}
const rgbStr = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ scene
export function createScene(engine, settings, { mobile = false, lite = false } = {}) {
  const BABYLON = B(), scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.03, 1);
  scene.ambientColor = new BABYLON.Color3(1, 1, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR; scene.fogStart = 34; scene.fogEnd = 100;
  scene.fogColor = new BABYLON.Color3(0.06, 0.06, 0.08);
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.diffuse = new BABYLON.Color3(0.48, 0.48, 0.52); hemi.groundColor = new BABYLON.Color3(0.24, 0.21, 0.18);
  hemi.specular = new BABYLON.Color3(0, 0, 0);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(0.30, -1.0, 0.22).normalize(), scene);
  sun.position = new BABYLON.Vector3(-6, 22, 4); sun.intensity = 0.95;
  sun.diffuse = new BABYLON.Color3(0.95, 0.93, 0.88); sun.specular = new BABYLON.Color3(0.9, 0.9, 0.88);
  sun.shadowMinZ = 1; sun.shadowMaxZ = 45;
  sun.autoUpdateExtends = false; sun.shadowFrustumSize = 34;
  let shadows = null;
  if (settings.shadows) {
    shadows = new BABYLON.ShadowGenerator(lite ? 1024 : mobile ? 2048 : 4096, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = mobile || lite ? BABYLON.ShadowGenerator.QUALITY_LOW : BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0008; shadows.normalBias = 0.01; shadows.darkness = 0.15;
  }
  return { scene, sun, hemi, shadows };
}

// ------------------------------------------------------------------ arena
export function buildArena(scene, settings, shadows, courtInfo, assetBase) {
  const BABYLON = B(), hx = C.COURT_WIDTH / 2, hz = C.COURT_LENGTH / 2, rimH = settings.rim_height;
  const recv = (m) => { m.receiveShadows = !!shadows; return m; };
  const cast = (m) => { if (shadows) shadows.addShadowCaster(m); return m; };
  // floor: court texture (with all FIBA markings) over a glossy maple plane
  const W = courtInfo.width_m, L = courtInfo.length_m;
  const ct = paintCourt(scene, W, L);
  const floorMat = varnishedMaple(scene, ct, W, L);
  const floor = meshFrom('floor', { positions: [-W / 2, 0, -L / 2, W / 2, 0, -L / 2, W / 2, 0, L / 2, -W / 2, 0, L / 2], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] }, scene, floorMat);
  recv(floor);
  const lines = recv(courtLines(scene));
  const sur = BABYLON.MeshBuilder.CreateGround('surround', { width: 100, height: 110 }, scene);
  sur.position.y = -0.01; sur.material = std(scene, 'surround', [0.09, 0.10, 0.13], { spec: 0.06 }); recv(sur);

  const hoops = [+1, -1].map((sign) => buildHoop(scene, sign, rimH, shadows));
  // perimeter: scorer's table, benches, LED boards
  const bb = new BoxBuilder();
  bb.box([-(hx + 2.6), 0.4, 0], [0.8, 0.8, 6], [0.1, 0.1, 0.12], 0, [0.2, 0.2, 0.22]);
  for (const zc of [-7.5, 7.5]) {
    bb.box([-(hx + 3.0), 0.25, zc], [0.5, 0.45, 6], [0.15, 0.15, 0.6]);
    for (let k = 0; k < 12; k++) bb.box([-(hx + 3.2), 0.5, zc - 2.75 + k * 0.5], [0.35, 0.5, 0.4], [0.2, 0.2, 0.75]);
  }
  colorMesh(scene, 'perimeter', bb, 0.2);
  const led = textTexture(scene, 'SHOOT WITH FORM  •  BALANCE · EYES · ELBOW · FOLLOW-THROUGH', 2048, 128, '#fff', 'rgb(10,60,160)', 64);
  for (const [pos, sc, ry] of [[[hx + 3.6, 0.45, 0], [26, 0.9], 90], [[-(hx + 4.2), 0.45, 0], [26, 0.9], -90],
    [[0, 0.45, hz + 3.8], [14, 0.9], 0], [[0, 0.45, -(hz + 3.8)], [14, 0.9], 180]]) {
    const p = BABYLON.MeshBuilder.CreatePlane('led', { width: sc[0], height: sc[1], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    p.position.set(...pos); p.rotation.y = ry * Math.PI / 180;
    p.material = std(scene, 'ledm', [1, 1, 1], { emissive: 1, tex: led });
  }
  const stadium = settings.crowd ? buildStadium(scene, { mobile: settings._mobile, lite: settings._lite }) : null;
  buildBuilding(scene);
  if (!settings._lite) glassReflections(scene, hoops, settings._mobile);
  // polished-floor reflections: a blurred planar mirror, strongest at grazing angles
  let mirror = null;
  if (settings.reflections && !settings._lite) {           // lite mode skips the mirror pass
    const mobile = settings._mobile;
    mirror = new BABYLON.MirrorTexture('floorMirror', { ratio: mobile ? 0.35 : 0.6 }, scene, true);
    mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, 0);
    mirror.adaptiveBlurKernel = mobile ? 6 : 10;
    mirror.level = 0.55;
    for (const mt of [floorMat, lines.material]) {
      mt.reflectionTexture = mirror;
      mt.reflectionFresnelParameters = new BABYLON.FresnelParameters({
        leftColor: new BABYLON.Color3(1, 1, 1), rightColor: new BABYLON.Color3(0.16, 0.16, 0.16), bias: 0.08, power: 2.4 });
    }
  }
  const skipReflect = new Set(['floor', 'courtlines', 'surround', 'hl', 'arc', 'trail', 'linefloor', 'lineplane', 'net']);
  if (settings._mobile) for (const n of ['seats0', 'seats1', 'bowl']) skipReflect.add(n);   // phones: the bowl stays out of the mirror
  const refreshReflections = () => {
    if (!mirror) return;
    mirror.renderList = scene.meshes.filter((m) => !skipReflect.has(m.name) && m.renderingGroupId === 0 && !m.metadata?.noReflect);   // overlays stay out of the floor
  };
  return { floor, hoops, hoop: hoops[0], refreshReflections };
}
/**
 * Varnished maple: the court texture (markings + paint) plus a tiled 2 m x 2 m
 * detail of 36 boards that lines up with the boards painted in court.jpg
 * (5.56 cm wide, starting at the left apron edge): grooves, staggered butt joints,
 * slight cupping and grain in a normal map, and board-to-board tone in a detail map.
 */
function varnishedMaple(scene, courtTex, W, L) {
  const BABYLON = B(), N = 1024, boards = 36, bw = N / boards, r = rng(31);
  const segChoices = [N / 4, N / 3, N / 2, N];                // segment lengths that tile cleanly
  const seg = [], off = [], tone = [];
  for (let b = 0; b < boards; b++) { seg.push(segChoices[Math.floor(r() * 4)]); off.push(Math.floor(r() * N)); tone.push((r() - 0.5) * 0.10); }
  const h = new Float32Array(N * N), dif = new Uint8Array(N * N * 4);
  // fine grain noise along the boards (y): smooth random walk per column
  const grain = new Float32Array(N * N);
  for (let x = 0; x < N; x++) { let g = 0, v = 0; for (let y = 0; y < N; y++) { v += (r() - 0.5) * 0.25; v *= 0.96; g = v; grain[y * N + x] = g; } }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = Math.floor(x / bw), fx = x / bw - b, sy = ((y + off[b]) % seg[b]) / seg[b], segId = Math.floor((y + off[b]) / seg[b]);
    const gx = Math.min(fx, 1 - fx) * bw, gy = Math.min(sy, 1 - sy) * seg[b];
    let z = 0.18 * Math.cos((fx - 0.5) * Math.PI);                // gentle cupping across each board
    z -= 1.0 * Math.exp(-gx * gx / 0.9);                         // groove between boards
    z -= 0.8 * Math.exp(-gy * gy / 0.7);                         // butt joint
    z += 0.12 * grain[y * N + x];
    h[y * N + x] = z;
    const st = tone[b] + 0.035 * Math.sin(segId * 12.9898 + b * 78.233) + 0.03 * grain[y * N + ((x + 7) % N)];
    const i = 4 * (y * N + x);
    dif[i] = Math.max(0, Math.min(255, 128 + st * 255 - 18 * Math.exp(-gx * gx / 1.2)));
    dif[i + 1] = 128; dif[i + 2] = 128; dif[i + 3] = 128;
  }
  const nrm = new Uint8Array(N * N * 4), k = 0.9;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N], hy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    let nx = -hx * k, ny = -hy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = 4 * (y * N + x);
    nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const raw = (data) => {
    const t = BABYLON.RawTexture.CreateRGBATexture(data, N, N, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; t.uScale = W / 2; t.vScale = L / 2; t.anisotropicFilteringLevel = 16;
    return t;
  };
  const m = new BABYLON.StandardMaterial('floor', scene);
  m.diffuseTexture = courtTex;
  m.specularColor = new BABYLON.Color3(0.42, 0.40, 0.36); m.specularPower = 110;   // hard varnish highlight
  m.bumpTexture = raw(nrm); m.bumpTexture.level = 0.55;
  m.detailMap.texture = raw(dif); m.detailMap.isEnabled = true;
  m.detailMap.diffuseBlendLevel = 0.6; m.detailMap.bumpLevel = 0;
  return m;
}
function colorMesh(scene, name, bb, spec = 0.1, emissive = 0) {
  const m = meshFrom(name, bb.build(), scene, std(scene, name + 'm', [1, 1, 1], { spec, emissive }));
  m.useVertexColors = true; m.hasVertexAlpha = false;
  m.freezeWorldMatrix(); m.isPickable = false;
  return m;
}
/** cord texture laid out on the NetSim knot lattice (knot (i, j) at u = (j + (i % 2) / 2) / cols, v = i / (rows - 1)) */
function netTexture(scene, rows, cols) {
  const BABYLON = B(), W = cols * 64, H = (rows - 1) * 64, t = new BABYLON.DynamicTexture('nettex', { width: W, height: H }, scene, true);
  const g = t.getContext(); g.clearRect(0, 0, W, H); g.lineCap = 'round';
  const X = (i, j) => (j + (i % 2) / 2) * W / cols, Y = (i) => i * H / (rows - 1);
  for (const [lw, col] of [[9, 'rgba(140,140,148,0.95)'], [5.5, 'rgba(255,255,255,1)']]) {
    g.lineWidth = lw; g.strokeStyle = col; g.beginPath();
    for (let i = 0; i < rows - 1; i++) for (let j = -1; j <= cols + 1; j++) {
      const off = i % 2;
      for (const dj of [off - 1, off]) { g.moveTo(X(i, j), Y(i)); g.lineTo(X(i + 1, j + dj), Y(i + 1)); }
    }
    g.moveTo(0, 2); g.lineTo(W, 2); g.stroke();
  }
  t.hasAlpha = true; t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; t.update(true);
  return t;
}
function buildHoop(scene, sign, rimH, shadows) {
  const BABYLON = B(), bz = sign * C.basketZ(), boardZ = sign * (C.COURT_LENGTH / 2 - C.BACKBOARD_FROM_BASELINE);
  const v3 = (x, y, z) => new BABYLON.Vector3(x, y, z), cast = (m) => { if (shadows) shadows.addShadowCaster(m); m.isPickable = false; return m; };
  const mats = scene._hoopMats || (scene._hoopMats = {
    rim: std(scene, 'rimm', [0.98, 0.33, 0.06], { spec: 0.75, power: 90 }),
    steel: std(scene, 'steelm', [0.16, 0.17, 0.19], { spec: 0.55, power: 70 }),
    alu: std(scene, 'alum', [0.78, 0.80, 0.83], { spec: 0.9, power: 110 }),
    pad: std(scene, 'padm', [0.07, 0.17, 0.48], { spec: 0.10, power: 18 }),
    padDark: std(scene, 'paddm', [0.05, 0.07, 0.12], { spec: 0.12, power: 20 }),
    white: std(scene, 'paintm', [1, 1, 1], { spec: 0.3, power: 60, emissive: 0.25 }),
    edge: std(scene, 'glassedgem', [0.42, 0.66, 0.60], { spec: 1, power: 150, alpha: 0.55 }),
  });
  const box = (name, [x, y, z], [w, h, d], mat) => { const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); m.material = mat; return cast(m); };
  const tube = (name, path, r, mat, cap = BABYLON.Mesh.CAP_ALL) => { const m = BABYLON.MeshBuilder.CreateTube(name, { path, radius: r, tessellation: 18, cap }, scene); m.material = mat; return cast(m); };

  // ---- ring: 20 mm rod on a flange plate, two braces underneath, 12 net hooks
  const rim = meshFrom('rim', torus(C.RIM_INNER_R + C.RIM_TUBE_R, C.RIM_TUBE_R, 64, 14), scene, mats.rim);
  rim.position.set(0, rimH, bz); cast(rim);
  const back = bz + sign * (C.RIM_INNER_R + C.RIM_TUBE_R), face = boardZ - sign * 0.006;
  box('flange', [0, rimH - 0.045, face], [0.17, 0.13, 0.012], mats.rim);
  box('rimarm', [0, rimH - 0.012, (back + face) / 2], [0.12, 0.02, Math.abs(face - back) + 0.01], mats.rim);
  for (const sx of [-1, 1]) {
    const a = Math.PI / 2 - sx * 0.95, R = C.RIM_INNER_R + C.RIM_TUBE_R;                // braces from the sides of the ring
    tube('rimbrace', [v3(sx * Math.sin(0.95) * (R - 0.003), rimH - 0.004, bz + sign * Math.cos(0.95) * (R - 0.003)), v3(sx * 0.055, rimH - 0.1, face - sign * 0.004)], 0.0065, mats.rim);   // welded under the ring tube
  }
  for (let k = 0; k < 12; k++) {
    const a = 2 * Math.PI * (k + 0.5) / 12, r = C.RIM_INNER_R + 0.004;
    const h = BABYLON.MeshBuilder.CreateCylinder('hook', { diameter: 0.007, height: 0.03, tessellation: 6 }, scene);
    h.position.set(Math.cos(a) * r, rimH - 0.02, bz + Math.sin(a) * r); h.rotation.x = 0.35 * Math.sin(a) * sign; h.rotation.z = -0.35 * Math.cos(a);
    h.material = mats.rim; h.isPickable = false;
  }
  // ---- net: a little cloth (NetSim) drawn as a grid over its knots with a cord texture
  const sim = new NetSim({ rTop: C.RIM_INNER_R + 0.004, rBottom: 0.112, length: C.NET_LENGTH });   // bottom just narrower than the ball: it checks it
  const R = sim.rows, Cn = sim.cols, pos = new Float32Array(R * (Cn + 1) * 3), uv = [], idx = [];
  for (let i = 0; i < R; i++) for (let j = 0; j <= Cn; j++) uv.push((j + (i % 2) / 2) / Cn, 1 - i / (R - 1));
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn; j++) {
    const a = i * (Cn + 1) + j, b2 = a + 1, c2 = a + Cn + 1, d2 = c2 + 1;
    idx.push(a, c2, b2, b2, c2, d2);
  }
  const fill = () => {
    for (let i = 0; i < R; i++) for (let j = 0; j <= Cn; j++) {
      const k = 3 * (i * Cn + (j % Cn)), o = 3 * (i * (Cn + 1) + j);
      pos[o] = sim.P[k]; pos[o + 1] = sim.P[k + 1]; pos[o + 2] = sim.P[k + 2];
    }
  };
  fill();
  const net = new BABYLON.Mesh('net', scene), vd = new BABYLON.VertexData(), nrm = [];
  BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
  vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.normals = nrm; vd.applyToMesh(net, true);
  const nm = scene._netMat || (scene._netMat = (() => { const m = std(scene, 'netm', [1, 1, 1], { spec: 0.05, emissive: 0.35 }); m.diffuseTexture = netTexture(scene, R, Cn); m.backFaceCulling = false; return m; })());
  net.material = nm; net.position.set(0, rimH, bz); net.isPickable = false; net.alwaysSelectAsActiveMesh = true;
  const nn = new Float32Array(nrm.length);
  // ---- backboard: tempered glass in an aluminium edge frame, painted border + shooter's square, padded bottom
  const w = C.BACKBOARD_W, h = C.BACKBOARD_H, bbBottom = rimH + C.BACKBOARD_BOTTOM_ABOVE_RIM, bbCy = bbBottom + h / 2, gz = boardZ + sign * 0.0125;
  const glass = BABYLON.MeshBuilder.CreateBox('glass', { width: w, height: h, depth: 0.025 }, scene);
  glass.position.set(0, bbCy, gz); glass.isPickable = false;
  const gm = scene._glassMat || (scene._glassMat = (() => {
    const m = std(scene, 'glassm', [0.55, 0.70, 0.70], { spec: 1, power: 260, alpha: 0.16 });
    m.backFaceCulling = false;
    m.reflectionFresnelParameters = new BABYLON.FresnelParameters({ bias: 0.12, power: 2.2, leftColor: new BABYLON.Color3(1, 1, 1), rightColor: new BABYLON.Color3(0.18, 0.18, 0.2) });
    m.opacityFresnelParameters = new BABYLON.FresnelParameters({ bias: 0.15, power: 2.5, leftColor: new BABYLON.Color3(0.85, 0.85, 0.85), rightColor: new BABYLON.Color3(0.13, 0.13, 0.13) });
    return m; })());
  glass.material = gm; glass.alphaIndex = 10;
  const e = 0.012;                                                                          // green glass edge seen through the frame
  for (const [x, y, sw, sh] of [[0, bbCy + h / 2 - e / 2, w, e], [0, bbCy - h / 2 + e / 2, w, e], [-w / 2 + e / 2, bbCy, e, h], [w / 2 - e / 2, bbCy, e, h]]) {
    const m = box('glassedge', [x, y, gz], [sw, sh, 0.026], mats.edge); m.alphaIndex = 11; }
  const fw = 0.028;                                                                         // aluminium frame round the glass
  for (const [x, y, sw, sh] of [[0, bbCy + h / 2 + fw / 2, w + 2 * fw, fw], [0, bbCy - h / 2 - fw / 2, w + 2 * fw, fw], [-w / 2 - fw / 2, bbCy, fw, h], [w / 2 + fw / 2, bbCy, fw, h]])
    box('glassframe', [x, y, gz], [sw, sh, 0.04], mats.alu);
  const t = 0.05, fz = boardZ - sign * 0.0015, tw = C.TARGET_BOX_W, th = C.TARGET_BOX_H, ty0 = rimH;
  const paint = new BoxBuilder();
  for (const [cx, cy, sx, sy] of [[0, bbBottom + h - t / 2, w, t], [0, bbBottom + t / 2, w, t], [-w / 2 + t / 2, bbCy, t, h], [w / 2 - t / 2, bbCy, t, h],
    [0, ty0 + th - t / 2, tw, t], [0, ty0 + t / 2, tw, t], [-tw / 2 + t / 2, ty0 + th / 2, t, th], [tw / 2 - t / 2, ty0 + th / 2, t, th]]) paint.box([cx, cy, fz], [sx, sy, 0.003], [1, 1, 1]);
  const pm = meshFrom('boardpaint', paint.build(), scene, mats.white); pm.isPickable = false;
  // padding: along the bottom edge and 35 cm up each side, wrapped round the frame
  box('boardpad', [0, bbBottom - 0.03, gz], [w + 0.1, 0.06, 0.08], mats.pad);
  for (const sx of [-1, 1]) box('boardpad', [sx * (w / 2 + 0.035), bbBottom + 0.175, gz], [0.05, 0.41, 0.08], mats.pad);
  // shot clock on top
  box('clockbox', [0, bbBottom + h + 0.2, boardZ + sign * 0.06], [0.72, 0.30, 0.14], mats.padDark);
  const clock = BABYLON.MeshBuilder.CreatePlane('clock', { width: 0.6, height: 0.24 }, scene);
  clock.position.set(0, bbBottom + h + 0.2, boardZ - sign * 0.011);
  clock.rotation.y = sign > 0 ? 0 : Math.PI;
  clock.material = scene._clockMat || (scene._clockMat = std(scene, 'clockm', [1, 1, 1], { emissive: 1, tex: textTexture(scene, '24', 256, 128, 'rgb(255,40,30)', 'rgb(8,8,8)', 100) }));

  // ---- support: padded base unit, raked post and a curved boom to a frame behind the glass
  const baseZ = sign * (C.COURT_LENGTH / 2 + 2.3), front = baseZ - sign * 0.95;
  box('stanbase', [0, 0.45, baseZ + sign * 0.1], [1.2, 0.9, 1.7], mats.steel);
  box('stanpad', [0, 0.52, front + sign * 0.06], [1.32, 1.04, 0.14], mats.pad);              // court-facing pad
  const top = box('stanpad', [0, 0.97, front + sign * 0.42], [1.32, 0.12, 0.84], mats.pad);  // pad over the front of the base
  box('stancap', [0, 0.93, baseZ + sign * 0.75], [1.22, 0.06, 0.5], mats.padDark);
  const frameZ = boardZ + sign * 0.07;
  const P = [v3(0, 1.0, baseZ - sign * 0.05), v3(0, 1.9, baseZ - sign * 0.45), v3(0, 2.75, baseZ - sign * 0.95), v3(0, 3.45, baseZ - sign * 1.75),
    v3(0, bbCy + 0.28, frameZ + sign * 0.75), v3(0, bbCy + 0.05, frameZ + sign * 0.06)];
  const boom = BABYLON.Curve3.CreateCatmullRomSpline(P, 10, false).getPoints();
  tube('boom', boom, 0.085, mats.steel);
  const padPath = boom.filter((p) => p.y < 2.4);
  tube('postpad', padPath, 0.15, mats.pad);
  // rear frame and braces (seen through the glass)
  const rf = new BoxBuilder(), FW = 1.16, FH = 0.66, m = 0.045, steelC = [0.16, 0.17, 0.19];
  for (const [x, y, sw, sh] of [[0, bbCy + FH / 2, FW, m], [0, bbCy - FH / 2, FW, m], [-FW / 2, bbCy, m, FH], [FW / 2, bbCy, m, FH], [0, bbCy, m, FH]])
    rf.box([x, y, frameZ], [sw, sh, 0.05], steelC);
  rf.box([0, rimH - 0.05, boardZ + sign * 0.06], [0.26, 0.2, 0.08], [0.12, 0.12, 0.13]);   // breakaway spring housing behind the ring
  const frame = meshFrom('boardframe', rf.build(), scene, mats.steel); frame.useVertexColors = false; cast(frame);
  // braces start on the boom itself (the point of the curve at that distance behind the frame)
  const onBoom = (dz) => boom.reduce((best, p) => (Math.abs(p.z - (frameZ + sign * dz)) < Math.abs(best.z - (frameZ + sign * dz)) ? p : best), boom[0]);
  const bTop = onBoom(0.6), bLow = onBoom(0.38);
  for (const sx of [-1, 1]) tube('brace', [bTop.clone(), v3(sx * (FW / 2 - 0.05), bbCy + FH / 2, frameZ)], 0.022, mats.steel);
  tube('brace', [bLow.clone(), v3(0, bbCy - FH / 2, frameZ)], 0.022, mats.steel);

  return { rim, net, glass, rimCenter: new V3(0, rimH, bz),
    /** advance the net by dt (skill time; a jump resets it); ball = world position or null, r = its radius */
    netStep(dt, ball, r) {
      if (dt === 0) return;
      const local = ball && Math.hypot(ball.x, ball.y - rimH, ball.z - bz) < 0.9 ? { x: ball.x, y: ball.y - rimH, z: ball.z - bz } : null;
      if (!local && !sim.ball && sim.idle) return;                                   // nothing moving: skip the work
      sim.step(dt, local, r);
      sim.idle = !local && sim.time > 1.5; sim.time = local ? 0 : sim.time + Math.max(0, dt);
      fill();
      BABYLON.VertexData.ComputeNormals(pos, idx, nn);
      net.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
      net.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nn);
    },
    setNetProgress() {} };
}
/** glass reflections: one static cube capture of the arena from each backboard */
function glassReflections(scene, hoops, mobile) {
  const BABYLON = B(), skip = new Set(['glass', 'glassedge', 'net', 'floor', 'surround']);
  const list = scene.meshes.filter((m) => !skip.has(m.name) && m.renderingGroupId === 0 && !m.metadata?.noReflect);
  hoops.forEach((hp, i) => {
    const probe = new BABYLON.ReflectionProbe(`glassprobe${i}`, mobile ? 128 : 256, scene);
    probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    probe.position = hp.glass.position.clone();
    probe.renderList.push(...list);
    const m = hp.glass.material.clone(`glassm${i}`);
    m.reflectionTexture = probe.cubeTexture; hp.glass.material = m;
  });
}
function buildBuilding(scene) {
  const BABYLON = B(), bb = new BoxBuilder(), H = 27, X = 36.5, Z = 43.5, wall = [0.08, 0.08, 0.10];
  bb.box([0, H / 2, Z], [2 * X + 1, H, 1], wall); bb.box([0, H / 2, -Z], [2 * X + 1, H, 1], wall);
  bb.box([X, H / 2, 0], [1, H, 2 * Z], wall); bb.box([-X, H / 2, 0], [1, H, 2 * Z], wall);
  bb.box([0, H, 0], [2 * X + 1, 0.5, 2 * Z + 1], [0.05, 0.05, 0.06]);
  for (let z = -40; z <= 40; z += 5) bb.box([0, H - 1.2, z], [2 * X - 2, 0.6, 0.35], [0.16, 0.16, 0.18]);      // roof trusses
  for (const x of [-12, 12]) bb.box([x, H - 3.2, 0], [1.2, 0.9, 50], [0.2, 0.2, 0.22]);                       // catwalks
  colorMesh(scene, 'building', bb, 0);
  const lb = new BoxBuilder();
  for (const x of [-12, 12]) for (let z = -21; z <= 21; z += 3.5) lb.box([x + (x > 0 ? -0.9 : 0.9), H - 3.75, z], [0.7, 0.25, 0.7], [1, 0.98, 0.9]);
  colorMesh(scene, 'lights', lb, 0, 1);
  const Y = 16.5;
  const jb = BABYLON.MeshBuilder.CreateBox('jumbotron', { width: 8, height: 4.2, depth: 5.6 }, scene);
  jb.position.set(0, Y, 0); jb.material = std(scene, 'jbm', [0.06, 0.06, 0.07], { spec: 0.2 });
  const screen = textTexture(scene, 'HOOPFORM', 1024, 512, 'rgb(255,210,60)', 'rgb(15,25,70)', 170);
  for (const [pos, ry, w] of [[[0, Y, 2.81], 180, 7.6], [[0, Y, -2.81], 0, 7.6], [[4.01, Y, 0], -90, 5.2], [[-4.01, Y, 0], 90, 5.2]]) {
    const s = BABYLON.MeshBuilder.CreatePlane('screen', { width: w, height: 3.8 }, scene);
    s.position.set(...pos); s.rotation.y = ry * Math.PI / 180;
    s.material = std(scene, 'screenm', [1, 1, 1], { emissive: 1, tex: screen });
  }
}

export { AvatarView } from './avatarView.js';

// ------------------------------------------------------------------ ball
export class BallView {
  constructor(scene, radius, size, shadows, assetBase) {
    const BABYLON = B();
    const mat = new BABYLON.StandardMaterial('ballm', scene);
    mat.diffuseTexture = new BABYLON.Texture(`${assetBase}ball${size}_albedo.jpg`, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    mat.diffuseTexture.anisotropicFilteringLevel = 8;
    mat.bumpTexture = new BABYLON.Texture(`${assetBase}ball_normal.png`, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    mat.bumpTexture.level = 0.8;
    mat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3); mat.specularPower = 22;
    this.mesh = meshFrom('ball', uvSphere(radius, 48, 64), scene, mat);
    this.mesh.rotationQuaternion = new BABYLON.Quaternion();
    this.mesh.receiveShadows = !!shadows;
    if (shadows) shadows.addShadowCaster(this.mesh);
    this.gripYaw = 90;
    this.trail = null; this._trailN = -1;
    this._m = new BABYLON.Matrix();
  }
  sync(pos, rot) {
    // outer: position + flight orientation; inner: fixed seam orientation of the grip
    const W = mul4(compose([0, 0, 0], [0, this.gripYaw, 0], [1, 1, 1]), compose([pos.x, pos.y, pos.z], rot, [1, 1, 1]));
    B().Matrix.FromArrayToRef(W, 0, this._m);
    this._m.decompose(this.mesh.scaling, this.mesh.rotationQuaternion, this.mesh.position);
  }
  updateTrail(scene, phys, flightT, enabled) {
    const BABYLON = B();
    if (!enabled || flightT < 0) { if (this.trail) this.trail.isVisible = false; return; }
    let n = Math.floor(Math.min(flightT, phys.t_through != null ? phys.t_through + 0.25 : flightT) / phys.DT);
    n = Math.max(2, Math.min(n, phys.samples.length));
    if (n === this._trailN && this.trail) { this.trail.isVisible = true; return; }
    this._trailN = n;
    const pts = [];
    for (let i = 0; i < n; i += 4) { const p = phys.samples[i][0]; pts.push(new BABYLON.Vector3(p.x, p.y, p.z)); }
    if (pts.length < 2) pts.push(pts[0].clone());
    if (this.trail) this.trail.dispose();
    this.trail = BABYLON.MeshBuilder.CreateLines('trail', { points: pts }, scene);
    this.trail.color = new BABYLON.Color3(1, 0.75, 0.2); this.trail.alpha = 0.85; this.trail.isPickable = false;
  }
  dispose() { this.mesh.dispose(); if (this.trail) this.trail.dispose(); }
}

// ------------------------------------------------------------------ overlays
export class Overlays {
  static GUIDE_N = 48;
  constructor(scene) {
    const BABYLON = B();
    this.scene = scene;
    this.arcs = [0, 1, 2].map(() => {
      const pts = Array.from({ length: 22 }, () => new BABYLON.Vector3());
      const m = BABYLON.MeshBuilder.CreateLines('arc', { points: pts, updatable: true }, scene);
      m.renderingGroupId = 1; m.isVisible = false; m.isPickable = false; return m;
    });
    const lm = std(scene, 'linem', [1, 0.85, 0.2], { emissive: 1, alpha: 0.55 });
    this.lineFloor = BABYLON.MeshBuilder.CreatePlane('linefloor', { size: 1 }, scene); this.lineFloor.material = lm;
    const pm = std(scene, 'planem', [1, 0.85, 0.2], { emissive: 1, alpha: 0.09 }); pm.backFaceCulling = false;
    this.linePlane = BABYLON.MeshBuilder.CreatePlane('lineplane', { size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene); this.linePlane.material = pm;
    this.lineFloor.isVisible = this.linePlane.isVisible = false;
    // shot readout: launch and entry angle wedges, and a drop line from the top of the arc
    this.shotArcs = [0, 1].map(() => {
      const m = BABYLON.MeshBuilder.CreateLines('sarc', { points: Array.from({ length: 22 }, () => new BABYLON.Vector3()), updatable: true }, scene);
      m.renderingGroupId = 1; m.isVisible = false; m.isPickable = false; m.color = new BABYLON.Color3(0.45, 0.85, 1); return m;
    });
    const z = () => new BABYLON.Vector3();
    this.apexLines = BABYLON.MeshBuilder.CreateLineSystem('apex', { lines: [[z(), z()], [z(), z()], [z(), z()]], updatable: true }, scene);
    this.apexLines.color = new BABYLON.Color3(1, 0.85, 0.3); this.apexLines.isVisible = false; this.apexLines.isPickable = false;
    // ideal arc (entry 45°) and the acceptable band (entry 38-52°), light grey
    const N = Overlays.GUIDE_N, blank = () => Array.from({ length: N }, () => new BABYLON.Vector3());
    this.guide = ['opt', 'lo', 'hi'].map((n) => {
      const m = BABYLON.MeshBuilder.CreateLines(`guide_${n}`, { points: blank(), updatable: true }, scene);
      m.color = n === 'opt' ? new BABYLON.Color3(0.92, 0.94, 0.97) : new BABYLON.Color3(0.7, 0.73, 0.78);
      m.alpha = n === 'opt' ? 0.9 : 0.5; m.isVisible = false; m.isPickable = false; return m;
    });
    const bm = std(scene, 'guideband', [0.8, 0.82, 0.86], { emissive: 0.6, alpha: 0.12 }); bm.backFaceCulling = false;
    this.band = BABYLON.MeshBuilder.CreateRibbon('guideband', { pathArray: [blank(), blank()], updatable: true, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    this.band.material = bm; this.band.isVisible = false; this.band.isPickable = false;
    for (const m of [...this.shotArcs, this.apexLines, ...this.guide, this.band, ...this.arcs, this.lineFloor, this.linePlane]) m.metadata = { ...(m.metadata || {}), noReflect: true };
  }
  _wedge(arc, A, Bp, Cp, radius) {
    // one line strip (22 points): ray out along a, back to the vertex, out along c, then the arc from c to a
    const BABYLON = B(), a = A.sub(Bp).norm(), c = Cp.sub(Bp).norm();
    const P = [Bp.add(a.mul(radius * 1.6)), Bp, Bp.add(c.mul(radius * 1.6))];
    for (let k = 0; k <= 18; k++) { const t = k / 18, v = c.mul(1 - t).add(a.mul(t)); P.push(Bp.add((v.len() > 1e-6 ? v.norm() : a).mul(radius))); }
    BABYLON.MeshBuilder.CreateLines('sarc', { points: P.map((p) => new BABYLON.Vector3(p.x, p.y, p.z)), instance: arc });
    arc.isVisible = true;
    let mid = a.add(c); mid = mid.len() > 1e-6 ? mid.norm() : new V3(0, 1, 0);
    return Bp.add(mid.mul(radius * 1.25));                                            // label anchor, inside the wedge
  }
  /** paths = null hides them; else { opt, lo, hi } as arrays of GUIDE_N points from the release to the ring */
  setGuideArcs(paths) {
    const BABYLON = B(), on = !!paths;
    this.guide.forEach((m) => { m.isVisible = on; }); this.band.isVisible = on;
    if (!on || paths === this._guidePaths) return;
    this._guidePaths = paths;
    const v = (p) => new BABYLON.Vector3(p.x, p.y, p.z);
    ['opt', 'lo', 'hi'].forEach((k, i) => BABYLON.MeshBuilder.CreateLines(`guide_${k}`, { points: paths[k].map(v), instance: this.guide[i] }));
    BABYLON.MeshBuilder.CreateRibbon('guideband', { pathArray: [paths.lo.map(v), paths.hi.map(v)], instance: this.band });
  }
  /** s = null hides it; else { p0, launchDir, horiz, entryPos, entryDir, apex, rimY } */
  setShotReadout(s) {
    const BABYLON = B();
    if (!s) { this.shotArcs.forEach((a) => { a.isVisible = false; }); this.apexLines.isVisible = false; return null; }
    const la = this._wedge(this.shotArcs[0], s.p0.add(s.horiz), s.p0, s.p0.add(s.launchDir), 0.42);
    const ea = this._wedge(this.shotArcs[1], s.entryPos.sub(s.horiz), s.entryPos, s.entryPos.sub(s.entryDir), 0.34);
    const v = (p) => new BABYLON.Vector3(p.x, p.y, p.z), ap = s.apex, side = new V3(-s.horiz.z, 0, s.horiz.x).mul(0.18);
    // just a small tick across the top of the arc (no drop line); the unused lines collapse to a point
    BABYLON.MeshBuilder.CreateLineSystem('apex', { lines: [[v(ap), v(ap)], [v(ap.sub(side)), v(ap.add(side))], [v(ap), v(ap)]], instance: this.apexLines });
    this.apexLines.isVisible = true;
    return { launch: la, entry: ea, apex: ap.add(new V3(0, 0.2, 0)) };
  }
  setArc(i, A, Bp, Cp, good, radius) {
    const BABYLON = B(), arc = this.arcs[i];
    if (!A) { arc.isVisible = false; return null; }
    const a = A.sub(Bp).norm(), c = Cp.sub(Bp).norm(), pts = [Bp.add(a.mul(radius * 1.6))];
    for (let k = 0; k <= 19; k++) { const t = k / 19, v = a.mul(1 - t).add(c.mul(t)); pts.push(Bp.add((v.len() > 1e-6 ? v.norm() : a).mul(radius))); }
    pts.push(Bp.add(c.mul(radius * 1.6)));
    BABYLON.MeshBuilder.CreateLines('arc', { points: pts.map((p) => new BABYLON.Vector3(p.x, p.y, p.z)), instance: arc });
    arc.color = good ? new BABYLON.Color3(0.35, 1, 0.45) : new BABYLON.Color3(1, 0.6, 0.15);
    arc.isVisible = true;
    let mid = a.add(c); mid = mid.len() > 1e-6 ? mid.norm() : new V3(0, 1, 0);
    return Bp.sub(mid.mul(0.12)).add(new V3(0, 0.03, 0));       // label anchor
  }
  setLine(on, start, end, rimH) {
    this.lineFloor.isVisible = this.linePlane.isVisible = on;
    if (!on) return;
    const d = end.sub(start), L = d.len(), yaw = Math.atan2(d.x, d.z), mid = start.add(end).mul(0.5);
    this.lineFloor.position.set(mid.x, 0.004, mid.z); this.lineFloor.rotation.set(Math.PI / 2, yaw, 0); this.lineFloor.scaling.set(0.05, L, 1);
    this.linePlane.position.set(mid.x, rimH / 2, mid.z); this.linePlane.rotation.set(0, yaw + Math.PI / 2, 0); this.linePlane.scaling.set(L, rimH, 1);
  }
}
