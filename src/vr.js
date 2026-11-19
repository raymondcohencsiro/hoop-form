// VR mode (WebXR, built on Babylon.js): the "Switch to VR" button, the session, controllers, teleporting,
// the floating coaching panel and 3D labels. The app's own actions (play, phases, speed, skill, hand)
// are reused as they are; viewpoints and thumbstick maths live in vrmath.js (headless, tested).
/* global BABYLON */
import { DEG } from './math.js';
import { VrPanel } from './vrPanel.js';
import { viewSpot, constrainWalk, panelPose, stickEdge, PANEL_W } from './vrmath.js';

const B = () => window.BABYLON;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SNAP_TURN = 45;

/** Small billboards in the 3D scene (joint angles, shot readout): the page's DOM labels cannot be seen in a headset. */
class VrLabels {
  constructor(scene) {
    const BABYLON = B();
    this.head = null;
    this.items = Array.from({ length: 7 }, (_, i) => {
      const wide = i === 6, w = wide ? 512 : 256, h = wide ? 90 : 96;
      const mesh = BABYLON.MeshBuilder.CreatePlane(`vrlbl${i}`, { width: wide ? 0.8 : 0.34, height: wide ? 0.14 : 0.13 }, scene);
      const tex = new BABYLON.DynamicTexture(`vrlbltex${i}`, { width: w, height: h }, scene, true); tex.hasAlpha = true;
      const m = new BABYLON.StandardMaterial(`vrlblm${i}`, scene);
      m.disableLighting = true; m.emissiveTexture = tex; m.opacityTexture = tex; m.diffuseColor = new BABYLON.Color3(0, 0, 0); m.specularColor = new BABYLON.Color3(0, 0, 0); m.fogEnabled = false;
      mesh.material = m; mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; mesh.renderingGroupId = 1; mesh.isPickable = false; mesh.setEnabled(false);
      mesh.metadata = { noReflect: true };
      return { mesh, tex, w, h, key: '' };
    });
  }
  set(i, p, text, color = '#fff') {
    const it = this.items[i]; if (!it) return;
    if (!p) { it.mesh.setEnabled(false); return; }
    it.mesh.position.set(p.x, p.y, p.z); it.mesh.setEnabled(true);
    if (this.head) { const d = Math.hypot(p.x - this.head.x, p.y - this.head.y, p.z - this.head.z); it.mesh.scaling.setAll(clamp(d / 2.5, 0.8, 2.4)); }   // stays readable from across the court
    const key = text + color; if (it.key === key) return; it.key = key;
    const ctx = it.tex.getContext(); ctx.clearRect(0, 0, it.w, it.h);
    ctx.beginPath(); const r = 22; ctx.moveTo(r, 0); ctx.arcTo(it.w, 0, it.w, it.h, r); ctx.arcTo(it.w, it.h, 0, it.h, r); ctx.arcTo(0, it.h, 0, 0, r); ctx.arcTo(0, 0, it.w, 0, r); ctx.closePath();
    ctx.fillStyle = 'rgba(10,12,18,0.78)'; ctx.fill();
    let fs = it.w > 300 ? 46 : 54; ctx.font = `800 ${fs}px "Helvetica Neue", Arial, sans-serif`;
    while (fs > 20 && ctx.measureText(text).width > it.w - 24) { fs -= 2; ctx.font = `800 ${fs}px "Helvetica Neue", Arial, sans-serif`; }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, it.w / 2, it.h / 2 + 2);
    it.tex.update();                                                                // default invertY (false would draw the label upside down)
  }
  hide(from = 0) { for (let i = from; i < this.items.length; i++) this.items[i].mesh.setEnabled(false); }
  dispose() { for (const it of this.items) { it.mesh.dispose(false, true); it.tex.dispose(); } }
}

export class VR {
  constructor(app) {
    this.app = app; this.supported = false; this.active = false; this.xr = null; this.busy = false; this.hand = null; this.held = false;   // hand: the left controller the panel rides on
    this.grip = { left: false, right: false }; this.gripSince = 0;                  // both grips held for a moment = leave VR
    this.lastSpot = null; this.follow = false; this.fadeS = null; this.pending = 0; this.drag = false; this.hoverPtr = null; this._mt = 0;
  }

  // ---------------------------------------------------------------- set-up
  async init() {
    try { this.supported = !!(navigator.xr && window.isSecureContext && await navigator.xr.isSessionSupported('immersive-vr')); } catch { this.supported = false; }
    if (!this.supported) return;
    document.body.classList.add('vrok');
    for (const id of ['bVR', 'bVRm']) { const b = $(id); if (b) b.onclick = (e) => { e.currentTarget.blur(); if (this.active) this.exit(); else this.enter(); }; }
    this.ready = this.create();
  }
  async create() {
    const a = this.app, scene = a.scene, BABYLON = B();
    const xr = await scene.createDefaultXRExperienceAsync({
      disableDefaultUI: true, disableHandTracking: true, disableNearInteraction: true,
      floorMeshes: [a.arena.floor],
      pointerSelectionOptions: { preferredHandedness: 'right', disableSwitchOnClick: true },   // only the right controller points and clicks; the left one carries the panel
      teleportationOptions: { forceHandedness: 'left', backwardsMovementEnabled: false, defaultTargetMeshOptions: { disableLighting: true } },
    });
    if (scene !== a.scene) { try { xr.dispose(); } catch { /* scene already replaced */ } return; }
    this.xr = xr; this.scene = scene; this.tele = xr.teleportation; this.ptr = xr.pointerSelection;
    this.panel = new VrPanel(scene); this.labels = new VrLabels(scene); this.makeFade(scene);
    if (this.ptr) { try { this.ptr.raySelectionPredicate = (m) => m === this.panel.mesh; } catch { /* older build: relies on isPickable below */ } }
    this.refreshPickable();
    scene.onNewMeshAddedObservable.add((m) => { m.isPickable = m.name === 'vrpanel' || m === a.arena.floor; });   // only the panel and the floor are ever picked
    scene.onPointerObservable.add((info) => this.onPointer(info));
    xr.baseExperience.onStateChangedObservable.add((st) => {
      if (st === BABYLON.WebXRState.IN_XR) this.onEnter(); else if (st === BABYLON.WebXRState.NOT_IN_XR) this.onExit();
    });
    if (this.tele) this.tele.onAfterCameraTeleport.add(() => this.afterAimTeleport());
    xr.input.onControllerAddedObservable.add((ctrl) => ctrl.onMotionControllerInitObservable.add((mc) => this.bindController(mc, ctrl)));
    xr.input.onControllerRemovedObservable.add((ctrl) => { if (this.hand === ctrl) this.hand = null; });   // fires before Babylon disposes the controller's nodes
  }
  /** called before the scene is rebuilt (the XR helper belongs to one scene) and again once the new one exists */
  dispose() {
    try { if (this.xr) this.xr.dispose(); } catch { /* already gone */ }
    try { if (this.panel) this.panel.dispose(); if (this.labels) this.labels.dispose(); if (this.fade) this.fade.dispose(false, true); } catch { /* scene gone */ }
    this.xr = this.tele = this.ptr = this.panel = this.labels = this.fade = null; this.active = false; this.fadeS = null; this.hand = null; this.held = false; this.grip = { left: false, right: false }; this.gripSince = 0;
  }
  onWorldRebuilt() { if (this.supported) this.ready = this.create().catch((e) => console.warn('VR set-up failed', e)); }
  onPlayerRebuilt() { if (this.xr) this.refreshPickable(); }
  refreshPickable() { const floor = this.app.arena.floor; for (const m of this.scene.meshes) m.isPickable = m === floor || (this.panel && m === this.panel.mesh); }
  makeFade(scene) {
    const BABYLON = B(), m = BABYLON.MeshBuilder.CreateSphere('vrfade', { diameter: 1, segments: 8, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const mat = new BABYLON.StandardMaterial('vrfadem', scene);
    mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(0, 0, 0); mat.diffuseColor = new BABYLON.Color3(0, 0, 0); mat.specularColor = new BABYLON.Color3(0, 0, 0); mat.alpha = 0; mat.fogEnabled = false;
    m.material = mat; m.renderingGroupId = 3; m.isPickable = false; m.isVisible = false; m.alwaysSelectAsActiveMesh = true; m.metadata = { noReflect: true };
    this.fade = m;
  }

  // ---------------------------------------------------------------- session
  async enter() {
    const a = this.app;
    if (this.busy || this.active) return;
    this.busy = true;
    try {
      if (a.engine.hoopformBackend === 'WebGPU') { a.flash('VR needs WebGL2: reloading without WebGPU, then tap the VR button again'); location.hash = ''; setTimeout(() => location.reload(), 900); return; }
      await this.ready;
      if (!this.xr) throw new Error('the VR session is not ready yet');
      await this.xr.baseExperience.enterXRAsync('immersive-vr', 'local-floor');
    } catch (err) { console.error(err); a.flash(`Could not start VR: ${err && err.message ? err.message : err}`); } finally { this.busy = false; }
  }
  async exit() { try { if (this.xr) await this.xr.baseExperience.exitXRAsync(); } catch { /* already out */ } }
  onEnter() {
    const a = this.app, cam = this.xr.baseExperience.camera;
    this.active = true; document.body.classList.add('invr');
    // the headset browser blurs the page window when the session starts; with renderEvenInBackground off Babylon then skips every XR frame (blank headset)
    this._bgRender = a.engine.renderEvenInBackground; a.engine.renderEvenInBackground = true;
    if (a.trainer.active) a.setTrainer(false, true);
    if (a.camMode === 'first') a.setCamMode('auto', true);                         // first-person would hide the overlays
    this.setQuality(true);
    cam.minZ = 0.05; cam.maxZ = 160; this.fade.parent = cam;
    this.refreshPickable(); this.pending = 4;                                      // wait a few frames for the first head pose
    this._ptrDown = false; a._st = null;
  }
  onExit() {
    const a = this.app;
    if (!this.active) return;
    this.active = false; document.body.classList.remove('invr'); this.grip = { left: false, right: false }; this.gripSince = 0;
    a.engine.renderEvenInBackground = this._bgRender ?? false;                     // back to pausing when the page is hidden
    if (this.fade) { this.fade.parent = null; this.setFade(0); } this.fadeS = null;
    if (this.panel) this.panel.hide(); if (this.labels) this.labels.hide(0);
    this.setQuality(false);
    a.cam.setPreset(a.cam.preset, true); a.engine.resize(); a.refit(true);
  }
  /** cheaper rendering while in the headset, switched in place (rebuilding the scene would end the session) */
  setQuality(on) {
    const a = this.app, BABYLON = B();
    if (a.arena.setVrMode) a.arena.setVrMode(on);                                  // the planar floor mirror is wrong in stereo and costly
    if (a.shadows) a.shadows.filteringQuality = on || a.s._mobile || a.s._lite ? BABYLON.ShadowGenerator.QUALITY_LOW : BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    const far = this.scene.getMeshByName('seats1'); if (far) far.isVisible = !on;   // the far upper tier of seats
  }

  // ---------------------------------------------------------------- placing the person
  get cam() { return this.xr.baseExperience.camera; }
  headYaw() { const e = this.cam.rotationQuaternion.toEulerAngles(); return e.y / DEG; }
  /** put the head over (x, z), optionally turning to face yaw (deg). Moving the XR camera moves the tracking space. */
  placeHead(x, z, yaw) {
    const cam = this.cam, q = cam.rotationQuaternion;
    if (yaw != null && q) { const e = q.toEulerAngles(); q.copyFrom(B().Quaternion.RotationYawPitchRoll(yaw * DEG, e.x, e.z)); }
    cam.position.x = x; cam.position.z = z;
    this._check = { x, z, n: 8 };
  }
  turn(deg) {
    const cam = this.cam, q = cam.rotationQuaternion, e = q.toEulerAngles(), x = cam.position.x, z = cam.position.z;
    q.copyFrom(B().Quaternion.RotationYawPitchRoll(e.y + deg * DEG, e.x, e.z));
    cam.position.x = x; cam.position.z = z;                                        // turn on the spot
  }
  handNode() { const h = this.hand; return (h && (h.grip || h.pointer)) || null; }
  /** the panel rides on the left controller; with no left controller tracked it floats in front of you instead */
  placePanel() {
    const n = this.handNode(); this.held = !!n;
    if (n) this.panel.holdOn(n);
    else { const p = this.cam.position; this.panel.setPose(panelPose({ x: p.x, y: p.y, z: p.z }, this.headYaw())); }
  }
  togglePanel() { if (this.panel.visible) this.panel.hide(); else { this.placePanel(); this.panel.show(); } }
  spotCtx() { const a = this.app, c = a.core; return { focus: c.focus(), rim: c.rim, heading: c.heading, lefty: c.lefty, scale: a.s.player_height / 1.6 }; }
  goSpot(id, instant = false) {
    const s = viewSpot(id, this.spotCtx()); this.lastSpot = id;
    const go = () => { this.placeHead(s.x, s.z, s.yaw); if (this.panel.visible) this.placePanel(); };
    if (instant) go(); else this.startFade(go);
  }
  afterAimTeleport() {
    const p = this.cam.position, q = constrainWalk(p.x, p.z, this.app.core.focus());
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.02) this.placeHead(q.x, q.z, null);   // keep out of the player and off the stanchions
    this.lastSpot = null; if (this.panel.visible) this.placePanel();
  }
  startFade(fn) { this.fadeS = { t: 0, phase: 'out', fn }; }
  setFade(a) { if (!this.fade) return; this.fade.isVisible = a > 0.01; this.fade.material.alpha = a; }
  stepFade(dt) {
    const f = this.fadeS; if (!f) return;
    f.t += dt;
    if (f.phase === 'out') { const k = Math.min(1, f.t / 0.09); this.setFade(k); if (k >= 1) { f.fn(); f.phase = 'in'; f.t = 0; } }
    else { const k = Math.min(1, f.t / 0.16); this.setFade(1 - k); if (k >= 1) this.fadeS = null; }
  }
  /** "follow the player": no smooth camera movement (it makes people ill); instead it snaps back to the same viewpoint when the player has run off */
  stepFollow(dt) {
    if (!this.follow || !this.lastSpot || this.fadeS) return;
    this._ft = (this._ft || 0) + dt; if (this._ft < 0.5) return; this._ft = 0;
    const s = viewSpot(this.lastSpot, this.spotCtx()), p = this.cam.position;
    if (Math.hypot(s.x - p.x, s.z - p.z) > 2.2) this.startFade(() => { this.placeHead(s.x, s.z, s.yaw); if (this.panel.visible) this.placePanel(); });
  }

  // ---------------------------------------------------------------- controllers and the panel
  bindController(mc, ctrl) {
    const a = this.app, hand = mc.handedness, comp = (id) => mc.components && mc.components[id];
    const sq = comp('xr-standard-squeeze');
    if (sq && (hand === 'left' || hand === 'right')) sq.onButtonStateChangedObservable.add((s) => { this.grip[hand] = !!s.pressed; this.gripSince = this.grip.left && this.grip.right ? performance.now() : 0; });
    const press = (id, fn) => { const c = comp(id); if (!c) return false; c.onButtonStateChangedObservable.add((s) => { if (s.pressed && s.changes.pressed) fn(); }); return true; };
    if (hand === 'right') {
      const hasA = press('a-button', () => a.playPause());                            // A: play / pause
      press('b-button', () => a.stepNext());                                          // B: next phase
      if (!hasA) press('xr-standard-squeeze', () => a.playPause());                   // controllers without A / B: grip
      const st = comp('xr-standard-thumbstick'), turn = {}, spd = {};
      if (st) st.onAxisValueChangedObservable.add((v) => {                            // right stick: left / right snap-turns, up / down changes speed
        if (Math.abs(v.x) >= Math.abs(v.y)) { const d = stickEdge(turn, v.x); if (d) this.turn(d * SNAP_TURN); } else { const s = stickEdge(spd, v.y); if (s) a.changeSpeed(-s); }
      });
    } else if (hand === 'left') {
      this.hand = ctrl;                                                                // the panel follows this controller
      press('x-button', () => a.stepPrev());                                          // X: previous phase
      if (!press('y-button', () => this.togglePanel())) press('xr-standard-squeeze', () => this.togglePanel());   // Y: show / hide the panel
    }                                                                                 // left stick forward: teleport (Babylon's built-in feature)
  }
  onPointer(info) {
    if (!this.active || !this.panel.visible) return;
    const T = B().PointerEventTypes, pi = info.pickInfo, pid = info.event && info.event.pointerId;
    const onPanel = !!(pi && pi.hit && pi.pickedMesh === this.panel.mesh), uv = onPanel ? pi.getTextureCoordinates() : null, hit = onPanel ? this.panel.hit(uv) : null;
    if (info.type === T.POINTERMOVE) {
      if (hit) { this.hoverPtr = pid; this.panel.setHover(hit.id); } else if (pid === this.hoverPtr) this.panel.setHover(null);   // two rays: only the one that set the hover clears it
      if (this.drag && uv) this.scrubAt(uv.x);
    } else if (info.type === T.POINTERDOWN && hit) this.click(hit, uv);
    else if (info.type === T.POINTERUP) this.drag = false;
  }
  scrubAt(ux) {
    const tl = this.panel.layout.find((r) => r.id === 'timeline'), a = this.app;
    a.playing = false; a.stopAt = null; a.core.seek(clamp((ux * PANEL_W - tl.x) / tl.w, 0, 1) * a.core.end_time);
  }
  click(hit, uv) {
    const a = this.app, [k, v] = hit.id.split(':'), again = () => { if (this.lastSpot) this.goSpot(this.lastSpot); };
    switch (k) {
      case 'hide': this.panel.hide(); return;
      case 'tab': this.panel.setTab(v); return;
      case 'prev': a.stepPrev(); break;
      case 'next': a.stepNext(); break;
      case 'play': a.playPause(); break;
      case 'speed': a.changeSpeed(v === '+' ? 1 : -1); break;
      case 'hand': a.toggleHand(); again(); break;
      case 'timeline': this.drag = true; this.scrubAt(uv.x); break;
      case 'spot': this.goSpot(v); break;
      case 'follow': this.follow = !this.follow; break;
      case 'skill': if (v !== a.core.skill.key) { a.setSkill(v); again(); } break;
      case 'tg': { const key = { angles: 'showAngles', line: 'forceLine', trail: 'trailOn' }[v]; a[key] = !a[key]; break; }
      case 'height': a.setPlayerHeight(clamp(Math.round((a.s.player_height + (v === '+' ? 0.05 : -0.05)) * 100) / 100, 1.2, 2.1)); again(); break;
      case 'ball': a.setBallSize(+v); break;
      case 'exit': this.exit(); return;
      default: return;
    }
    this.panel.dirty = true;
  }
  model(idx, phase) {
    const a = this.app, c = a.core, sk = c.display_skill, res = c.checks(phase), okN = res.filter((r) => r.ok).length, T = c.end_time, on = new Set();
    if (a.showAngles) on.add('tg:angles'); if (a.forceLine) on.add('tg:line'); if (a.trailOn) on.add('tg:trail');
    on.add(`skill:${c.skill.key}`); on.add(`ball:${a.s.ball_size}`); if (this.lastSpot) on.add(`spot:${this.lastSpot}`); if (this.follow) on.add('follow');
    return { skillKeys: a.skills.order, skillNames: Object.fromEntries(a.skills.skills.map((s) => [s.key, s.name])), skillKey: c.skill.key, shortName: sk.short_name || sk.name,
      title: phase.title, phaseNo: idx + 1, phaseCount: sk.phases.length, badge: res.length ? `${okN}/${res.length} OK` : '', badgeOk: okN === res.length, phase, checks: res,
      playing: a.playing, speed: a.s.playback_speed, hand: a.s.handedness, u: c.t / T, ticks: c.timeline.times.slice(0, -1).map((t) => t / T),
      release: c.timeline.release_time != null ? c.timeline.release_time / T : null, on, spot: this.lastSpot, follow: this.follow,
      heightText: `${a.s.player_height.toFixed(2)} m`, ballSize: a.s.ball_size };
  }

  // ---------------------------------------------------------------- labels (called by the app while in VR)
  label(i, pos, text, color) { if (this.labels) this.labels.set(i, pos, text, color); }
  hideLabels(from = 0) { if (this.labels) this.labels.hide(from); }

  // ---------------------------------------------------------------- per frame
  update(dt, idx, phase) {
    if (!this.xr || !this.active) return;
    if (this.pending > 0 && --this.pending === 0) { this.goSpot('coach', true); this.placePanel(); this.panel.show(); }
    this.labels.head = this.cam.position;
    this.stepFade(dt); this.stepFollow(dt);
    if (this.gripSince && performance.now() - this.gripSince > 1000) { this.gripSince = 0; this.exit(); return; }   // hold both grips for a second
    if (this.panel.visible) {
      const n = this.handNode();                                                    // follow the left controller every frame (or fall back to the world when it is gone)
      if (n) { this.held = true; this.panel.holdOn(n); } else if (this.held) this.placePanel();
      const now = performance.now();
      if (this.panel.dirty || now - this._mt > 50) { this._mt = now; this.panel.update(this.model(idx, phase), now); }
    }
    if (this._check && --this._check.n === 0) {          // one-off sanity check that moving the XR camera really moved the person
      const p = this.cam.position, err = Math.hypot(p.x - this._check.x, p.z - this._check.z);
      if (err > 0.3 && !this._warned) { this._warned = true; console.warn(`[VR] placement is ${err.toFixed(2)} m off; the XR camera did not take the new position`); }
      this._check = null;
    }
  }
}
