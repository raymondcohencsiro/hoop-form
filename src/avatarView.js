// Babylon view of the avatar: a skinned body + clothing driven by the kinematic
// skeleton, rigid detail parts (head, hands, shoes), and procedurally painted
// fabric / hair / sneaker textures.
/* global BABYLON */
import { JOINTS } from './avatar.js';
import { JERSEY, jerseyCut, hairAbove } from './body.js';

const B = () => window.BABYLON;
const TAU = Math.PI * 2;
const css = (c, k = 1) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function vdata(g) {
  const vd = new (B().VertexData)();
  vd.positions = g.positions; vd.normals = g.normals; vd.uvs = g.uvs; vd.indices = g.indices;
  if (g.colors) vd.colors = g.colors;
  if (g.matricesIndices) { vd.matricesIndices = g.matricesIndices; vd.matricesWeights = g.matricesWeights; }
  return vd;
}
const PAINTED = new Map();   // painted canvases are reused across rebuilds (skill / hand changes)
function canvasTex(scene, name, w, h, paint, opts = {}) {
  const key = `${name}|${w}x${h}|${opts.key || ''}`;
  let src = PAINTED.get(key);
  if (!src) {
    src = document.createElement('canvas'); src.width = w; src.height = h;
    paint(src.getContext('2d', { willReadFrequently: true }), w, h);
    PAINTED.set(key, src);
  }
  const t = new (B().DynamicTexture)(name, { width: w, height: h }, scene, true);
  const ctx = t.getContext(); ctx.clearRect(0, 0, w, h); ctx.drawImage(src, 0, 0);
  t.update();
  t.anisotropicFilteringLevel = 8;
  return t;
}
const vary = (r, amt) => 1 + (r() - 0.5) * amt;

// ---- jersey: base colour, trimmed armholes / neckline, side panels, numbers, mesh-knit noise
function paintJersey(s) {
  return (ctx, W, Hc) => {
    const base = s.jersey_color, trim = s.trim_color, img = ctx.createImageData(W, Hc), d = img.data, r = rng(7);
    const y0 = JERSEY.y0, y1 = JERSEY.y1, band = 0.0072, rad = 0.095;
    const cut = (y, th) => jerseyCut(y, ((th % TAU) + TAU) % TAU);
    for (let py = 0; py < Hc; py++) {
      const v = 1 - (py + 0.5) / Hc, y = y0 + v * (y1 - y0);
      for (let px = 0; px < W; px++) {
        const th = (px + 0.5) / W * TAU;
        let col = base, alpha = 255;
        if (!cut(y, th)) alpha = 0;
        else {
          const dth = band / rad;
          let edge = false;
          for (let k = 0; k < 8 && !edge; k++) { const a = k * TAU / 8; if (!cut(y + Math.sin(a) * band, th + Math.cos(a) * dth)) edge = true; }
          const side = Math.min(Math.abs(((th + Math.PI) % TAU) - Math.PI), Math.abs(th - Math.PI));
          if (edge) col = trim;
          else if (y < 0.205 && side < 0.11) col = side < 0.05 ? trim : base.map((c) => c * 0.82);   // side panels with piping
        }
        const knit = ((px >> 1) + (py >> 1)) % 2 ? 0.985 : 1.015, n = vary(r, 0.05) * knit;
        const i = 4 * (py * W + px);
        d[i] = Math.min(255, col[0] * 255 * n); d[i + 1] = Math.min(255, col[1] * 255 * n); d[i + 2] = Math.min(255, col[2] * 255 * n); d[i + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    const num = String(s.jersey_number), vy = (y) => (1 - (y - y0) / (y1 - y0)) * Hc;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const [u, y, size] of [[0.25, 0.200, 0.30], [0.75, 0.195, 0.40]]) {
      ctx.font = `900 ${Math.round(Hc * size)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      ctx.save(); ctx.translate(u * W, vy(y)); ctx.scale(0.86, 1);
      ctx.lineWidth = Hc * 0.022; ctx.strokeStyle = '#fff'; ctx.strokeText(num, 0, 0);
      ctx.fillStyle = css(trim); ctx.fillText(num, 0, 0);
      ctx.restore();
    }
  };
}
// ---- shorts: elastic waistband, side stripes, hem
function paintShorts(s, leg) {
  return (ctx, W, Hc) => {
    const r = rng(leg ? 3 : 5), img = ctx.createImageData(W, Hc), d = img.data;
    for (let py = 0; py < Hc; py++) {
      const v = 1 - (py + 0.5) / Hc;
      for (let px = 0; px < W; px++) {
        const u = (px + 0.5) / W;
        let col = s.jersey_color, k = 1;
        if (leg) {
          const du = Math.min(u, 1 - u);
          if (du < 0.045) col = du < 0.03 ? s.trim_color : [1, 1, 1];
          if (v > 0.955) col = s.trim_color;
          k = 1 - 0.08 * Math.pow(Math.max(0, 1 - Math.abs(((u * 7.3 + v * 0.6) % 1) - 0.5) * 6), 2) * (1 - v);   // soft folds
        } else {
          const du = Math.min(u, Math.abs(u - 0.5), 1 - u);
          if (du < 0.022) col = du < 0.014 ? s.trim_color : [1, 1, 1];
          if (v > 0.9) { col = s.jersey_color; k = 0.82 + 0.06 * ((py >> 1) % 2); }                     // ribbed elastic band
        }
        const n = vary(r, 0.05) * (((px >> 1) + (py >> 1)) % 2 ? 0.985 : 1.015) * k, i = 4 * (py * W + px);
        d[i] = Math.min(255, col[0] * 255 * n); d[i + 1] = Math.min(255, col[1] * 255 * n); d[i + 2] = Math.min(255, col[2] * 255 * n); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}
// ---- hair: dense short strands radiating from the crown
function paintHair(s) {
  return (ctx, W, Hc) => {
    const r = rng(11), c = s.hair_color;
    ctx.fillStyle = css(c); ctx.fillRect(0, 0, W, Hc);
    for (let k = 0; k < 26000; k++) {
      const x = r() * W, y = r() * Hc, len = 6 + r() * 14, a = Math.PI / 2 + (r() - 0.5) * 0.5;
      const sh = 0.55 + r() * 1.0;
      ctx.strokeStyle = css(c, sh); ctx.globalAlpha = 0.35 + r() * 0.4; ctx.lineWidth = 0.8 + r() * 0.9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const img = ctx.getImageData(0, 0, W, Hc), d = img.data, r2 = rng(23);
    for (let py = 0; py < Hc; py++) for (let px = 0; px < W; px++) {
      const a = hairAbove((px + 0.5) / W, 1 - (py + 0.5) / Hc) + (r2() - 0.5) * 0.0035;
      d[4 * (py * W + px) + 3] = a > 0 ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
  };
}
// ---- sneaker upper: white leather, laces, toe box, heel counter, side stripe, collar lining
function paintShoe(s) {
  return (ctx, W, Hc) => {
    const img = ctx.createImageData(W, Hc), d = img.data, r = rng(19), trim = s.trim_color, jc = s.jersey_color;
    for (let py = 0; py < Hc; py++) {
      const v = 1 - (py + 0.5) / Hc;                       // 0 heel .. 1 toe
      for (let px = 0; px < W; px++) {
        const u = (px + 0.5) / W;                          // .25 top, 0 / .5 the two sides
        let col = [0.95, 0.95, 0.96];
        const top = Math.abs(u - 0.25), side = Math.min(Math.abs(u - 0.0), Math.abs(u - 1), Math.abs(u - 0.5));
        if (v > 0.86) col = [0.88, 0.88, 0.9];                                                     // toe box
        if (v < 0.13) col = jc;                                                                    // heel counter
        const stripeC = 0.075 + 0.05 * (v - 0.2);                                                  // swept side stripe
        if (v > 0.16 && v < 0.74 && (Math.abs(u - stripeC) < 0.022 || Math.abs((0.5 - u) - stripeC) < 0.022)) col = trim;
        if (top < 0.055 && v > 0.30 && v < 0.67) {                                                 // tongue + laces
          col = [0.80, 0.80, 0.82];
          const ph = ((v - 0.30) / 0.045) % 1;
          if (top < 0.045 && Math.abs(ph - 0.5) < 0.16) col = [0.98, 0.98, 0.98];
          if (top > 0.042) col = [0.25, 0.25, 0.27];                                               // eyelet rows
        }
        if (top < 0.12 && v < 0.30) col = [0.16, 0.16, 0.18];                                      // collar opening / lining
        if (top < 0.12 && v < 0.30 && Math.abs(top - 0.115) < 0.006) col = trim;
        if (side < 0.012 && v < 0.2) col = [0.2, 0.2, 0.22];                                       // heel pull seam
        const n = vary(r, 0.04), i = 4 * (py * W + px);
        d[i] = col[0] * 255 * n; d[i + 1] = col[1] * 255 * n; d[i + 2] = col[2] * 255 * n; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

export class AvatarView {
  constructor(scene, avatar, settings, shadows) {
    const BABYLON = B(), C3 = (c) => new BABYLON.Color3(c[0], c[1], c[2]);
    this.scene = scene; this.avatar = avatar; this.meshes = []; this.skinMeshes = []; this.highlights = {}; this.disposables = [];
    const mat = (name, rgb, { spec = 0.08, power = 16, tex = null, cull = true, cutout = false } = {}) => {
      const m = new BABYLON.StandardMaterial('av_' + name, scene);
      m.diffuseColor = C3(rgb); m.specularColor = new BABYLON.Color3(spec, spec, spec); m.specularPower = power;
      if (tex) m.diffuseTexture = tex;
      m.backFaceCulling = cull; if (!cull) m.twoSidedLighting = true;
      if (cutout) { tex.hasAlpha = true; m.useAlphaFromDiffuseTexture = true; m.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST; m.alphaCutOff = 0.5; }
      this.disposables.push(m); if (tex) this.disposables.push(tex);
      return m;
    };
    const skinC = settings.skin_color;
    const skin = mat('skin', skinC, { spec: 0.14, power: 14 });
    // warm subsurface-like rim: light bleeds red at grazing angles
    skin.emissiveColor = new BABYLON.Color3(1, 1, 1);
    skin.emissiveFresnelParameters = new BABYLON.FresnelParameters({ leftColor: new BABYLON.Color3(0.20 * skinC[0], 0.07 * skinC[1], 0.05 * skinC[2]), rightColor: new BABYLON.Color3(0, 0, 0), bias: 0.15, power: 2.2 });
    const sk = JSON.stringify([settings.jersey_color, settings.trim_color, settings.hair_color, settings.jersey_number]);
    const M = {
      skin,
      earInner: mat('earin', skinC.map((c) => c * 0.82), { spec: 0.05 }),
      jersey: mat('jersey', [1, 1, 1], { spec: 0.06, power: 10, cull: false, cutout: true, tex: canvasTex(scene, 'jerseyT', 1024, 512, paintJersey(settings), { key: sk }) }),
      shorts: mat('shorts', [1, 1, 1], { spec: 0.07, power: 10, cull: false, tex: canvasTex(scene, 'shortsT', 512, 256, paintShorts(settings, false), { key: sk }) }),
      shortsLeg: mat('shortsleg', [1, 1, 1], { spec: 0.07, power: 10, cull: false, tex: canvasTex(scene, 'shortsLT', 512, 256, paintShorts(settings, true), { key: sk }) }),
      sock: mat('sock', [0.96, 0.96, 0.96], { spec: 0.03 }),
      shoeTex: mat('shoe', [1, 1, 1], { spec: 0.35, power: 40, tex: canvasTex(scene, 'shoeT', 512, 512, paintShoe(settings), { key: sk }) }),
      midsole: mat('midsole', [0.97, 0.97, 0.97], { spec: 0.2, power: 20 }),
      sole: mat('sole', [0.13, 0.13, 0.15], { spec: 0.05 }),
      hair: mat('hair', [1, 1, 1], { spec: 0.18, power: 30, cutout: true, tex: canvasTex(scene, 'hairT', 1024, 512, paintHair(settings), { key: sk }) }),
      brow: mat('brow', settings.hair_color.map((c, k) => 0.6 * c + 0.4 * settings.skin_color[k] * 0.7), { spec: 0.03 }),
      eyeWhite: mat('eyew', [0.93, 0.92, 0.9], { spec: 0.9, power: 90 }),
      iris: mat('iris', [0.30, 0.18, 0.09], { spec: 1, power: 120 }),
      pupil: mat('pupil', [0.02, 0.02, 0.02], { spec: 1, power: 160 }),
      nail: mat('nail', skinC.map((c) => Math.min(1, c * 1.12 + 0.06)), { spec: 0.6, power: 60 }),
    };
    // skeleton: flat bones whose matrices are the joints' world matrices (bind = rest pose)
    const skel = this.skeleton = new BABYLON.Skeleton('avatarSkel', 'avatarSkel', scene);
    this.bones = JOINTS.map((n) => new BABYLON.Bone(n, skel, null, BABYLON.Matrix.FromArray(avatar.bind[n])));
    const addShadow = (m) => { m.receiveShadows = !!shadows; if (shadows) shadows.addShadowCaster(m); };
    for (const part of avatar.skinned) {
      const m = new BABYLON.Mesh('av_' + part.name, scene);
      vdata(part.geo).applyToMesh(m, false);
      m.material = M[part.mat]; m.skeleton = skel; m.numBoneInfluencers = 4;
      m.alwaysSelectAsActiveMesh = true; m.isPickable = false;
      addShadow(m); this.skinMeshes.push(m);
    }
    for (const part of avatar.parts) {
      const m = new BABYLON.Mesh('av_part', scene);
      vdata(part.geo.data).applyToMesh(m, false);
      m.material = M[part.mat]; m.rotationQuaternion = new BABYLON.Quaternion(); m.isPickable = false;
      addShadow(m); this.meshes.push([part, m]);
    }
    const hm = new BABYLON.StandardMaterial('hl', scene);
    hm.diffuseColor = new BABYLON.Color3(1, 0.82, 0.1); hm.emissiveColor = hm.diffuseColor; hm.disableLighting = true; hm.alpha = 0.35;
    this.disposables.push(hm);
    for (const name of Object.keys(avatar.j).filter((n) => n !== 'root')) {
      const s = BABYLON.MeshBuilder.CreateSphere('hl', { diameter: 1, segments: 12 }, scene);
      s.material = hm; s.isVisible = false; s.renderingGroupId = 1; s.isPickable = false;
      this.highlights[name] = s;
    }
    this._m = new BABYLON.Matrix();
  }
  sync() {
    const BABYLON = B(), j = this.avatar.j;
    JOINTS.forEach((n, i) => {
      BABYLON.Matrix.FromArrayToRef(j[n].world(), 0, this._m);
      this.bones[i].getLocalMatrix().copyFrom(this._m);
      this.bones[i].markAsDirty();
    });
    for (const [part, mesh] of this.meshes) {
      BABYLON.Matrix.FromArrayToRef(part.node.world(), 0, this._m);
      this._m.decompose(mesh.scaling, mesh.rotationQuaternion, mesh.position);
    }
  }
  showHighlights(names, time) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 6), H = this.avatar.H;
    for (const [n, h] of Object.entries(this.highlights)) {
      const on = names.includes(n);
      h.isVisible = on;
      if (on) { const p = this.avatar.j[n].worldPos(); h.position.set(p.x, p.y, p.z); h.scaling.setAll((0.062 + 0.012 * pulse) * H / 1.6 * 2); h.material.alpha = 0.22 + 0.18 * pulse; }
    }
  }
  dispose() {
    for (const [, m] of this.meshes) m.dispose();
    for (const m of this.skinMeshes) m.dispose();
    for (const h of Object.values(this.highlights)) h.dispose();
    this.skeleton.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
