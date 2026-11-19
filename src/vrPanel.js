// The floating VR panel: one plane in the world whose texture is drawn with the 2D canvas API
// (no extra libraries). Layout and hit-testing come from vrmath.js; vr.js decides what a click does.
/* global BABYLON */
import { PANEL_W as W, PANEL_H as H, PANEL_M, TABS, CONTENT, HELD_PANEL, heldPanelAxes, panelLayout, hitTest } from './vrmath.js';

const B = () => window.BABYLON;
const FONT = '"Helvetica Neue", Arial, sans-serif';
const COL = { bg: 'rgba(12,14,20,0.96)', line: 'rgba(255,255,255,0.14)', btn: 'rgba(255,255,255,0.09)', hover: 'rgba(255,255,255,0.24)',
  fg: '#eef0f4', dim: '#9aa2b1', accent: '#ffc23d', ink: '#1a1406', good: '#5be37a', bad: '#ff9a3c' };

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
// transport icons are drawn as shapes: the headset browser may not have the ⏮ ▶ ⏭ glyphs
function icon(ctx, kind, cx, cy, s, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round';
  const tri = (x, dir) => { ctx.beginPath(); ctx.moveTo(x + dir * s * 0.55, cy); ctx.lineTo(x - dir * s * 0.35, cy - s * 0.5); ctx.lineTo(x - dir * s * 0.35, cy + s * 0.5); ctx.closePath(); ctx.fill(); };
  if (kind === 'play') tri(cx, 1);
  else if (kind === 'pause') { ctx.fillRect(cx - s * 0.4, cy - s * 0.5, s * 0.28, s); ctx.fillRect(cx + s * 0.12, cy - s * 0.5, s * 0.28, s); }
  else if (kind === 'next') { tri(cx - s * 0.12, 1); ctx.fillRect(cx + s * 0.3, cy - s * 0.5, s * 0.18, s); }
  else if (kind === 'prev') { tri(cx + s * 0.12, -1); ctx.fillRect(cx - s * 0.48, cy - s * 0.5, s * 0.18, s); }
  else if (kind === 'close') { ctx.beginPath(); ctx.moveTo(cx - s * 0.4, cy - s * 0.4); ctx.lineTo(cx + s * 0.4, cy + s * 0.4); ctx.moveTo(cx + s * 0.4, cy - s * 0.4); ctx.lineTo(cx - s * 0.4, cy + s * 0.4); ctx.stroke(); }
}

export class VrPanel {
  constructor(scene) {
    const BABYLON = B();
    this.scene = scene; this.tab = 'cues'; this.hover = null; this.dirty = true; this.lastDraw = 0; this._key = '';
    this.mesh = BABYLON.MeshBuilder.CreatePlane('vrpanel', { width: PANEL_M.w, height: PANEL_M.h }, scene);
    this.tex = new BABYLON.DynamicTexture('vrpaneltex', { width: W, height: H }, scene, true);
    this.tex.hasAlpha = true; this.tex.anisotropicFilteringLevel = 8;
    const m = new BABYLON.StandardMaterial('vrpanelm', scene);
    m.disableLighting = true; m.emissiveTexture = this.tex; m.opacityTexture = this.tex; m.diffuseColor = new BABYLON.Color3(0, 0, 0);
    m.specularColor = new BABYLON.Color3(0, 0, 0); m.fogEnabled = false; m.backFaceCulling = true;
    this.mesh.material = m; this.mesh.renderingGroupId = 2; this.mesh.isPickable = true; this.mesh.setEnabled(false);
    this.mesh.metadata = { noReflect: true };
    this.ctx = this.tex.getContext();
    this.layout = panelLayout(this.tab, []);
  }
  get visible() { return this.mesh.isEnabled(); }
  show(pose) { if (pose) this.setPose(pose); this.mesh.setEnabled(true); this.dirty = true; }
  hide() { this.mesh.setEnabled(false); this.hover = null; }
  setPose(p) { this.mesh.rotationQuaternion = null; this.mesh.scaling.setAll(1); this.mesh.position.set(p.x, p.y, p.z); this.mesh.rotation.set(0, p.yaw, 0); }
  /** ride on a controller (call every frame). Not parented on purpose: Babylon disposes a controller's nodes, children included, when it drops off. */
  holdOn(node) {
    const BABYLON = B(), m = this.mesh, h = HELD_PANEL;
    if (!this._held) {
      const a = heldPanelAxes(), mat = BABYLON.Matrix.FromValues(a.right.x, a.right.y, a.right.z, 0, a.up.x, a.up.y, a.up.z, 0, -a.front.x, -a.front.y, -a.front.z, 0, 0, 0, 0, 1);   // rows: the plane's X, Y, Z in controller space
      this._held = { q: BABYLON.Quaternion.FromRotationMatrix(mat), off: new BABYLON.Vector3(h.offset.x, h.offset.y, h.offset.z), s: new BABYLON.Vector3(), r: new BABYLON.Quaternion() };
    }
    const k = this._held, wm = node.computeWorldMatrix(true);
    BABYLON.Vector3.TransformCoordinatesToRef(k.off, wm, m.position);
    wm.decompose(k.s, k.r, undefined);
    if (!m.rotationQuaternion) m.rotationQuaternion = new BABYLON.Quaternion();
    k.r.multiplyToRef(k.q, m.rotationQuaternion);                                   // controller rotation first in Babylon's order: parent.multiply(local)
    m.scaling.setAll(h.w / PANEL_M.w); m.computeWorldMatrix(true);                   // the pointer's pick reads this matrix before the next render
  }
  setTab(k) { this.tab = k; this.dirty = true; }
  /** a pick on the panel -> the button under it (uv from Babylon: v runs bottom to top) */
  hit(uv) { return uv ? hitTest(this.layout, uv.x * W, (1 - uv.y) * H) : null; }
  setHover(id) { if (id !== this.hover) { this.hover = id; this.dirty = true; } }
  dispose() { this.mesh.dispose(false, true); this.tex.dispose(); }

  /**
   * m: { skillKeys, skillNames, skillKey, title, phaseNo, phaseCount, badge, badgeOk, phase (display phase), checks, playing, speed,
   *      hand, u (0..1), ticks:[0..1], release (0..1|null), on:Set of active ids, spot, follow, heightText, ballSize }
   * Redraws only when something it shows changed, and at most ~15 times a second while playing.
   */
  update(m, now) {
    this.layout = panelLayout(this.tab, m.skillKeys);
    const live = this.tab === 'checks' ? m.checks.map((c) => Math.round(c.value ?? -999)).join(',') : '';
    const key = [m.skillKey, m.phaseNo, m.playing, m.speed, m.hand, this.tab, this.hover, Math.round(m.u * 220), [...m.on].join(','), m.spot, m.follow,
      m.heightText, m.ballSize, m.badge, live].join('|');
    if (key === this._key && !this.dirty) return;
    if (!this.dirty && now - this.lastDraw < 66) return;
    this._key = key; this.dirty = false; this.lastDraw = now;
    this.draw(m);
  }

  draw(m) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    rrect(ctx, 0, 0, W, H, 34); ctx.fillStyle = COL.bg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = COL.line; ctx.stroke();
    // header
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = COL.accent; ctx.font = `800 24px ${FONT}`; ctx.fillText(`PHASE ${m.phaseNo} OF ${m.phaseCount} · ${m.shortName}`.toUpperCase(), 40, 28);
    ctx.fillStyle = COL.fg; ctx.font = `800 40px ${FONT}`; ctx.fillText(m.title, 40, 62);
    if (m.badge) { ctx.font = `800 26px ${FONT}`; const bw = ctx.measureText(m.badge).width + 28; rrect(ctx, 930 - bw, 28, bw, 40, 20); ctx.fillStyle = m.badgeOk ? 'rgba(91,227,122,0.2)' : 'rgba(255,154,60,0.2)'; ctx.fill(); ctx.fillStyle = m.badgeOk ? COL.good : COL.bad; ctx.textAlign = 'center'; ctx.fillText(m.badge, 930 - bw / 2, 49); ctx.textAlign = 'left'; }
    // tabs + buttons
    for (const r of this.layout) this.button(ctx, r, m);
    // tab content
    ctx.save(); rrect(ctx, CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h, 14); ctx.clip();
    const ph = m.phase;
    if (this.tab === 'cues') this.items(ctx, ph.cues.map((x) => { const [h, more] = x.split(' — '); return { head: h, body: more }; }), 'Coaching cues');
    else if (this.tab === 'why') this.items(ctx, [{ body: ph.why, big: true }], 'Why it matters');
    else if (this.tab === 'faults') this.items(ctx, ph.faults.map((x) => { const [f, fix] = x.split(' → '); return { head: f, body: fix ? fix[0].toUpperCase() + fix.slice(1) : '', bodyColor: COL.good }; }), 'Common faults and fixes');
    else if (this.tab === 'drill') { const d = ph.drill || '', i = d.indexOf(': '); this.items(ctx, d ? [i > 0 && i < 40 ? { head: d.slice(0, i), body: d.slice(i + 2) } : { body: d, big: true }] : [], 'Practice drill'); }
    else if (this.tab === 'checks') this.checks(ctx, m.checks);
    else if (this.tab === 'spots') this.spotsText(ctx, m);
    else if (this.tab === 'more') this.moreText(ctx, m);
    ctx.restore();
    // timeline
    const tl = this.layout.find((r) => r.id === 'timeline');
    rrect(ctx, tl.x, tl.y + 16, tl.w, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
    rrect(ctx, tl.x, tl.y + 16, Math.max(12, tl.w * m.u), 12, 6); ctx.fillStyle = COL.accent; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; for (const t of m.ticks) ctx.fillRect(tl.x + tl.w * t - 1, tl.y + 8, 2, 28);
    if (m.release != null) { ctx.fillStyle = COL.bad; ctx.fillRect(tl.x + tl.w * m.release - 2, tl.y + 4, 4, 36); }
    ctx.beginPath(); ctx.arc(tl.x + tl.w * m.u, tl.y + 22, 14, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    // speed readout between the speed buttons
    ctx.fillStyle = COL.fg; ctx.font = `700 32px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(`${m.speed}×`, 545, 660); ctx.textAlign = 'left';
    this.tex.update();                                                              // default invertY: canvas top = panel top (update(false) draws it upside down, and clicks land mirrored)
  }

  button(ctx, r, m) {
    if (r.id === 'timeline') return;
    const on = m.on.has(r.id) || (r.id === 'tab:' + this.tab), hov = this.hover === r.id;
    rrect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.fillStyle = r.id === 'exit' ? (hov ? 'rgba(255,106,90,0.55)' : 'rgba(255,106,90,0.30)') : on ? COL.accent : hov ? COL.hover : COL.btn; ctx.fill();
    if (hov && !on) { ctx.lineWidth = 3; ctx.strokeStyle = COL.accent; ctx.stroke(); }
    const fg = r.id === 'exit' ? '#ffb4a8' : on ? COL.ink : COL.fg, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (r.id === 'play') return icon(ctx, m.playing ? 'pause' : 'play', cx, cy, 40, fg);
    if (r.id === 'prev' || r.id === 'next') return icon(ctx, r.id, cx, cy, 40, fg);
    if (r.id === 'hide') return icon(ctx, 'close', cx, cy, 30, fg);
    let label = r.label;
    if (r.id === 'hand') label = m.hand === 'left' ? 'Left-handed' : 'Right-handed';
    else if (r.id.startsWith('skill:')) label = m.skillNames[r.id.slice(6)] || label;
    else if (r.id.startsWith('tg:')) label = ({ angles: 'Angles', line: 'Line', trail: 'Trail', sound: 'Sound' })[r.id.slice(3)];
    else if (r.id === 'follow') label = `Follow the player: ${m.follow ? 'on' : 'off'}`;
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${r.id.startsWith('tab:') ? 26 : r.w < 90 ? 38 : 28}px ${FONT}`;
    let fs = parseInt(ctx.font.match(/(\d+)px/)[1], 10); while (fs > 16 && ctx.measureText(label).width > r.w - 14) { fs -= 2; ctx.font = `700 ${fs}px ${FONT}`; }
    ctx.fillText(label, cx, cy + 1); ctx.textAlign = 'left';
  }

  /** cues / faults / why / drill: the biggest type that fits the content box */
  items(ctx, items, heading) {
    const { x, y, w, h } = CONTENT;
    ctx.fillStyle = COL.dim; ctx.font = `700 22px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(heading.toUpperCase(), x + 4, y + 22);
    const top = y + 40, maxH = h - 46, maxW = w - 8;
    let fs = 36, laid = null;
    for (; fs >= 20; fs -= 2) {
      let used = 0; const out = [];
      for (const it of items) {
        const hs = it.big ? fs : fs, bs = it.big ? fs : Math.round(fs * 0.8);
        ctx.font = `800 ${hs}px ${FONT}`; const hl = it.head ? wrap(ctx, it.head, maxW) : [];
        ctx.font = `500 ${bs}px ${FONT}`; const bl = it.body ? wrap(ctx, it.body, maxW) : [];
        out.push({ it, hl, bl, hs, bs }); used += (hl.length * hs + bl.length * bs) * 1.22 + fs * 0.45;
      }
      laid = out; if (used <= maxH) break;
    }
    let cy = top;
    for (const { it, hl, bl, hs, bs } of laid) {
      ctx.fillStyle = COL.fg; ctx.font = `800 ${hs}px ${FONT}`; for (const l of hl) { cy += hs * 1.22; ctx.fillText(l, x + 4, cy); }
      ctx.fillStyle = it.bodyColor || (it.head ? COL.dim : COL.fg); ctx.font = `500 ${bs}px ${FONT}`; for (const l of bl) { cy += bs * 1.22; ctx.fillText(l, x + 4, cy); }
      cy += fs * 0.45;
    }
    ctx.textBaseline = 'middle';
  }
  checks(ctx, list) {
    const { x, y, w } = CONTENT;
    ctx.fillStyle = COL.dim; ctx.font = `700 22px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.fillText('CHECKPOINTS (LIVE)', x + 4, y + 22);
    if (!list.length) { ctx.fillStyle = COL.dim; ctx.font = `500 30px ${FONT}`; ctx.fillText('No checkpoints in this phase', x + 4, y + 90); ctx.textBaseline = 'middle'; return; }
    const rowH = Math.min(72, 330 / list.length);
    list.forEach((r, i) => {
      const ry = y + 44 + i * rowH;
      ctx.font = `700 ${rowH > 60 ? 30 : 26}px ${FONT}`; ctx.fillStyle = r.ok ? COL.fg : COL.bad; ctx.textAlign = 'left'; ctx.fillText(r.label, x + 4, ry + 24);
      ctx.textAlign = 'right'; ctx.fillStyle = r.ok ? COL.good : COL.bad; ctx.fillText(r.value == null ? '–' : `${Math.round(r.value)}${r.unit || ''}`, x + w - 4, ry + 24); ctx.textAlign = 'left';
      const bx = x + 4, bw = w - 8, by = ry + 36, lo = r.lo ?? 0, hi = r.hi ?? (r.lo != null ? r.lo * 2 : 100), span = (hi - lo) || 1, a = lo - span * 0.6, b = hi + span * 0.6;
      const P = (v) => bx + bw * Math.max(0, Math.min(1, (v - a) / (b - a)));
      rrect(ctx, bx, by, bw, 10, 5); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      const l0 = P(r.lo ?? a), l1 = P(r.hi ?? b); rrect(ctx, l0, by, Math.max(6, l1 - l0), 10, 5); ctx.fillStyle = 'rgba(91,227,122,0.55)'; ctx.fill();
      if (r.value != null) { ctx.beginPath(); ctx.arc(P(r.value), by + 5, 10, 0, Math.PI * 2); ctx.fillStyle = r.ok ? '#fff' : COL.bad; ctx.fill(); }
    });
    ctx.textBaseline = 'middle';
  }
  spotsText(ctx, m) {
    const { x } = CONTENT;
    ctx.fillStyle = COL.dim; ctx.font = `700 22px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText('VIEWPOINTS AROUND THE PLAYER', x + 4, 176); ctx.fillText('SPOTS ON THE COURT', x + 4, 312);
    ctx.font = `500 22px ${FONT}`; ctx.fillText('Or aim with the left thumbstick: push forward, let go to teleport.', x + 4, 468);
    ctx.textBaseline = 'middle';
  }
  moreText(ctx, m) {
    const { x } = CONTENT;
    ctx.fillStyle = COL.dim; ctx.font = `700 22px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText('SKILL', x + 4, 176); ctx.fillText('SHOW', x + 4, 252);
    ctx.fillStyle = COL.fg; ctx.font = `700 28px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText('Player height', x + 4, 361); ctx.textAlign = 'center'; ctx.fillText(m.heightText, x + 675, 361); ctx.textAlign = 'left';
    ctx.fillText('Ball size', x + 4, 433);
    ctx.fillStyle = COL.dim; ctx.font = `600 22px ${FONT}`; ctx.fillText('Leave VR any time: Exit VR (bottom right), or squeeze both grips for 1 s', x + 4, 506);
  }
}
