// HoopForm web app: wires the headless coaching core to the Babylon renderer,
// the HTML HUD, the cameras and keyboard / mouse / touch input.
import * as C from './config.js';
import { V3, DEG } from './math.js';
import { CoachCore } from './coach.js';
import { BallPhysics } from './ball.js';
import { createEngine, createScene, buildArena, AvatarView, BallView, Overlays } from './render.js';
import { OrbitCam, TrainerCam, ORDER, LABELS, STANCHIONS, forward, CAM_MODES, CAM_LABELS } from './cameras.js';

const CAM_HINTS = { auto: 'Auto camera: each phase picks the best view', third: 'Third person: drag to orbit, the camera follows the player',
  first: "First person: the player's own view - drag to look around", coach: 'Coach view: walk around the court' };
import { installPhoneUI } from './phone.js';

const BABYLON = window.BABYLON;
const $ = (id) => document.getElementById(id);
const ASSETS = new URL('../assets/', import.meta.url).href;
const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1.0];
const TRIPLE = { knee: ['hip', 'knee', 'ankle'], hip: ['shoulder', 'hip', 'knee'], elbow: ['shoulder', 'elbow', 'wrist'], wrist: ['elbow', 'wrist', 'fingertip'] };
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const MOBILE = TOUCH || Math.min(screen.width, screen.height) < 700;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('hoopform.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('hoopform.' + k, JSON.stringify(v, (key, val) => (key.startsWith('_') ? undefined : val))); } catch { /* private mode */ } },
};
const mirrorName = (n) => (/_[RL]$/.test(n) ? n.slice(0, -2) + (n.endsWith('_R') ? '_L' : '_R') : n);
const fmt = (v, unit) => (v == null ? '–' : `${Math.round(v)}${unit}`);

class App {
  async start() {
    if (TOUCH) document.body.classList.add('touchdev');
    const [skills, court] = await Promise.all([
      fetch(ASSETS + 'skills.json').then((r) => r.json()),
      fetch(ASSETS + 'court.json').then((r) => r.json()),
    ]);
    this.skills = skills; this.court = court;
    this.s = { look_sens: 0.25, lite: 'auto', ...C.defaultSettings(), ...(store.get('settings') || {}) };
    this.touch = TOUCH; this.autoLite = false;
    const qLite = new URLSearchParams(location.search).get('lite');
    this.liteForce = ['on', 'off'].includes(qLite) ? qLite : null;      // for testing: ?lite=on|off
    if (!skills.order.includes(this.s.skill)) this.s.skill = 'shooting';
    if (MOBILE && store.get('settings') == null) this.s.crowd = true;
    this.canvas = $('view');
    $('loadMsg').textContent = 'Starting the 3D engine…';
    const prefer = location.hash === '#webgpu' || new URLSearchParams(location.search).get('engine') === 'webgpu' ? 'webgpu' : 'webgl';
    this.engine = await createEngine(this.canvas, prefer);
    this.canvas = this.engine.getRenderingCanvas();
    this.engine.renderEvenInBackground = false;                          // stop drawing (and draining the battery) when hidden
    this.core = new CoachCore(this.s, skills);
    this.cam = new OrbitCam(); this.trainer = new TrainerCam();
    this.mode = 'continuous'; this.playing = true; this.stopAt = null;
    this.speedI = SPEEDS.indexOf(this.s.playback_speed); if (this.speedI < 0) this.speedI = 2;
    this.autoCam = true; this.camMode = 'auto'; this.fp = { dir: null, yaw: 0, pitch: 0, fov: 72 }; this.showAngles = true; this.forceLine = false; this.trailOn = true; this.gripYaw = 90;
    this.time = 0; this.keys = new Set(); this.freeRect = null;
    this.buildWorld();
    this.buildHud();
    this.bindInput();
    this.phone = installPhoneUI(this);
    window.addEventListener('resize', () => { this.engine.resize(); this.refit(); });
    new ResizeObserver(() => this.refit()).observe($('right'));
    this.engine.runRenderLoop(() => this.frame());
    $('loader').style.opacity = 0; setTimeout(() => $('loader').remove(), 450);
    const gpu = this.engine.hoopformBackend === 'WebGPU';
    $('backend').innerHTML = `Renderer: ${this.engine.hoopformBackend} · Babylon.js ${BABYLON.Engine.Version} ` +
      (navigator.gpu ? `<button id="bGpu" style="margin-left:6px">${gpu ? 'Use WebGL2' : 'Try WebGPU'}</button>` : '');
    if ($('bGpu')) $('bGpu').addEventListener('click', () => { location.hash = gpu ? '' : 'webgpu'; location.reload(); });
    if (!TOUCH) this.flash('Space play · ←/→ phases · 1–7 cameras · F walk around · ? help');
    this._fpsHold = performance.now() + 5000;
    // installable web app: cache files for offline use where the browser allows it
    try { if ('serviceWorker' in navigator && window.isSecureContext && window.top === window) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* not allowed in this frame */ }
  }

  // ---------------------------------------------------------------- world
  liteOn() { return this.liteForce ? this.liteForce === 'on' : this.s.lite === 'on' || (this.s.lite === 'auto' && this.autoLite); }
  setLite(v) {
    this.s.lite = v; store.set('settings', this.s);
    this.buildWorld();
    this.flash(v === 'auto' ? `Lite mode: automatic${this.autoLite ? ' (on now)' : ''}` : `Lite mode ${v}`);
  }
  buildWorld() {
    if (this.scene) this.scene.dispose();
    const lite = this.liteOn(), dpr = window.devicePixelRatio || 1;
    this.s._lite = lite;
    this.engine.setHardwareScalingLevel(1 / Math.min(dpr, lite ? 1.25 : MOBILE ? 2 : dpr));
    this._fpsHold = performance.now() + 4000; this._fpsLow = 0;
    const { scene, shadows } = createScene(this.engine, this.s, { mobile: MOBILE, lite });
    this.scene = scene; this.shadows = shadows;
    this.s._mobile = MOBILE;
    this.arena = buildArena(scene, this.s, shadows, this.court, ASSETS);
    this.overlays = new Overlays(scene);
    this.camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 2, -5), scene);
    this.camera.minZ = 0.05; this.camera.maxZ = 160;
    this.proj = new BABYLON.Matrix();
    this.core.s = this.s; this.core.rim = new V3(0, this.s.rim_height, C.basketZ());
    this.buildPlayer();
  }
  buildPlayer(keepTime = true) {
    const t = keepTime ? this.core.t : 0;
    this.core.rebuild();
    if (!keepTime) this.core.seek(0);
    if (this.avatarView) this.avatarView.dispose();
    if (this.ballView) this.ballView.dispose();
    this.avatarView = new AvatarView(this.scene, this.core.avatar, this.s, this.shadows);
    this.ballView = new BallView(this.scene, C.ballRadius(this.s), this.s.ball_size, this.shadows, ASSETS);
    this.ballView.gripYaw = this.gripYaw;
    this.arena.refreshReflections();
    const c = this.core;
    this.cam.mirror = c.lefty; this.cam.heading = c.heading; this.cam.dist_scale = c.skill.cam_scale; this.cam.scale = this.s.player_height / 1.6;
    this.trainer.setEyeHeight(c.player_eye_height);
    this.sampleFit();
    c.seek(Math.min(t, c.end_time));
    this.cam.setPreset(this.cam.preset, true);
    if (this.hudBuilt) this.rebuildHudSkill();
  }
  /** Sample the whole motion once; fitting to the current screen is then cheap. */
  sampleFit() {
    const c = this.core, a = c.avatar, tl = c.timeline, H = this.s.player_height, r = C.ballRadius(this.s), saved = c.t;
    const n = c.skill.moving ? 120 : 60, times = [];
    for (let i = 0; i <= n; i++) times.push(tl.total * i / n);
    if (tl.release_time != null) times.push(tl.release_time - 1e-3);
    this.fitSamples = times.map((t) => {
      c.seek(t);
      const pts = [a.head_center.worldPos().add(new V3(0, 0.075 * H, 0))];
      for (const m of ['toe_R', 'heel_R', 'toe_L', 'heel_L', 'fingertip_R', 'fingertip_L']) pts.push(a.markers[m].worldPos());
      for (const j of ['elbow_R', 'elbow_L', 'knee_R', 'knee_L']) pts.push(a.j[j].worldPos());
      if (!c.ball.released) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) pts.push(c.ballPos.add(new V3(...d).mul(r)));
      return { focus: c.focus(), pts };
    });
    c.seek(saved);
    this.refit();
  }
  /** Screen area not covered by the HUD (canvas pixels). */
  measureFree() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    let x0 = 0, x1 = W, y0 = 0, y1 = H;
    const vis = (el) => el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const L = $('left'), R = $('right'), Bt = $('bottom'), T = $('mTop');
    if (vis(L)) x0 = L.getBoundingClientRect().right + 6;
    if (vis(T)) y0 = T.getBoundingClientRect().bottom + 4;
    const bottomTop = vis(Bt) ? Bt.getBoundingClientRect().top - 6 : H;
    if (vis(R)) {
      const rr = R.getBoundingClientRect();
      if (rr.left > W * 0.45) x1 = rr.left - 6;           // side panel (desktop)
      else y1 = Math.min(bottomTop, rr.top - 6);           // bottom sheet (phone)
    }
    y1 = Math.min(y1, bottomTop);
    if (x1 - x0 < W * 0.3) { x0 = 0; x1 = W; }
    if (y1 - y0 < H * 0.25) { y0 = 0; y1 = H; }
    return { x0, x1, y0, y1, W, H };
  }
  refit(force = false) {
    if (!this.fitSamples) return;
    if (force) this._fitAspect = null;
    const f = this.freeRect = this.measureFree();
    const aspect = (f.x1 - f.x0) / Math.max(1, f.y1 - f.y0);
    if (Math.abs((this._fitAspect ?? 0) - aspect) < 0.01 && this._fitFor === this.fitSamples) return;
    this._fitAspect = aspect; this._fitFor = this.fitSamples;
    this.cam.fitPresets(this.fitSamples, this.core.rim, aspect);
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const rawDt = this.engine.getDeltaTime() / 1000, dt = Math.min(rawDt, 0.05), c = this.core;
    this.time += dt;
    if (this.playing) {
      let nt = c.t + dt * SPEEDS[this.speedI];
      if (this.mode === 'step' && this.stopAt != null && nt >= this.stopAt) { nt = this.stopAt; this.playing = false; }
      if (this.mode === 'continuous' && nt > c.end_time + 0.8) nt = 0;
      if (this.mode === 'step' && nt > c.end_time) { nt = c.end_time; this.playing = false; }
      if (nt !== c.t) c.seek(nt);
    }
    const [idx] = c.timeline.segment(c.t), phase = c.display_skill.phases[idx];
    // cameras
    let pose;
    if (this.trainer.active) {
      this.trainer.update(dt, this.trainerInput(), c.focus(), STANCHIONS);
      pose = this.trainer.pose();
    } else {
      // turning or zooming the auto camera hands it to you: that is third person
      if (this.camMode === 'auto' && this.cam.user_override) { this.camMode = 'third'; this.autoCam = false; }
      // auto: for the shot, swing round over the shooting shoulder so the hand, arc and ring are all in view
      const rt0 = c.timeline.release_time, inFlight = rt0 != null && c.t >= rt0 - 0.25 && c.ball.apex_y != null;   // a beat early, so it has settled by the release
      this.cam.shot = { apexY: c.ball.apex_y, p0: c.ball.p0 }; const fr = this.freeRect || this.measureFree();
      this.cam.aspect = (fr.x1 - fr.x0) / Math.max(1, fr.y1 - fr.y0);
      const want = inFlight ? 'shot' : phase.camera;
      if (this.autoCam && !this.cam.user_override && this.cam.preset !== want) this.cam.setPreset(want);
      const q = this.keys;
      if (q.has('KeyQ') || q.has('KeyE')) this.orbitView(((q.has('KeyE') ? 1 : 0) - (q.has('KeyQ') ? 1 : 0)) * 70 * dt, 0);
      this.cam.update(dt, c.focus(), c.rim);
      pose = this.camMode === 'first' ? this.firstPersonPose(dt) : this.cam.pose();
    }
    this.placeCamera(pose);
    // world
    this.avatarView.sync();
    this.ballView.sync(c.ballPos, c.ballRot);
    const rt = c.timeline.release_time, ft = rt != null ? c.t - rt : -1;
    this.ballView.updateTrail(this.scene, c.ball, c.ball.released ? ft : -1, this.trailOn);
    // the net is simulated in skill time (so it slows with the playback); stepping back resets it
    const dts = c.t - (this._netT ?? c.t); this._netT = c.t;
    this.arena.hoop.netStep(dts < 0 ? 1 : dts, c.ball.released ? c.ballPos : null, c.ball.r);
    this.avatarView.showHighlights(this.camMode === 'first' ? [] : c.lefty ? phase.focus.map(mirrorName) : phase.focus, this.time);
    this.updateLine(phase);
    this.scene.render();
    this.updateAngles(phase);
    this.updateShotReadout();
    this.updateHud(idx, phase, rawDt);
  }
  placeCamera(p) {
    const cam = this.camera, f = this.freeRect || this.measureFree();
    cam.position.set(p.pos.x, p.pos.y, p.pos.z);
    cam.rotation.set(p.pitch * DEG, p.yaw * DEG, 0);
    const W = Math.max(1, f.W), H = Math.max(1, f.H), aspect = W / H;
    let vfov, ox = 0, oy = 0;
    if (p.hfov) vfov = Math.min(2 * Math.atan(Math.tan(p.hfov * DEG / 2) / aspect), p.hfov * DEG);   // portrait: don't let the height fisheye
    else {
      // the preset fov describes the free area; centre the optical axis in it
      const fh = (f.y1 - f.y0) / H;
      vfov = 2 * Math.atan(Math.tan(p.vfov * DEG / 2) / fh);
      ox = ((f.x0 + f.x1) / 2 / W) * 2 - 1;
      oy = 1 - ((f.y0 + f.y1) / 2 / H) * 2;
    }
    this.vfov = vfov;
    BABYLON.Matrix.PerspectiveFovLHToRef(vfov, aspect, cam.minZ, cam.maxZ, this.proj, true, this.engine.isNDCHalfZRange);
    const m = this.proj.m;
    this.proj.setRowFromFloats(2, m[8] + ox, m[9] + oy, m[10], m[11]);
    cam.freezeProjectionMatrix(this.proj);
  }
  updateLine(phase) {
    const c = this.core;
    const on = (this.forceLine || ['rise', 'set', 'release'].includes(phase.key)) && c.skill.align_phase != null && !this.trainer.active && this.camMode !== 'first';
    if (!on) { this.overlays.setLine(false); return; }
    const foot = c.avatar.world(`ball_${c.avatar.side}`);
    this.overlays.setLine(true, new V3(c.ballPos.x, 0.004, foot.z - 0.3), new V3(c.rim.x, 0.004, c.rim.z), c.rim.y);
  }
  /**
   * When a jump shot or free throw goes in: the launch angle at the release, the top of the arc
   * (height, and how far above the ring) and the entry angle at the ring, in the scene and as a card.
   */
  updateShotReadout() {
    const c = this.core, b = c.ball, rt = c.timeline.release_time, card = $('shotCard');
    // ideal arc and acceptable band: from the release on, for the same release point
    const guideOn = rt != null && b.p0 && c.skill.key !== 'layup' && c.t >= rt - 1e-6 && this.camMode !== 'first';
    this.overlays.setGuideArcs(guideOn ? this.guidePaths() : null);
    const show = rt != null && b.t_through != null && b.entry_vel && c.skill.key !== 'layup' && c.t - rt >= b.t_through;
    if (!show) {
      this.overlays.setShotReadout(null); this.shotLabels.forEach((el) => { el.style.display = 'none'; });
      card.classList.remove('show'); return;
    }
    const horiz = new V3(b.v0.x, 0, b.v0.z).norm(), rimY = c.rim.y;
    const anchors = this.overlays.setShotReadout({ p0: b.p0, launchDir: b.v0.norm(), horiz, entryPos: b.entry_pos, entryDir: b.entry_vel.norm(), apex: b.apex_pos, rimY });
    const launch = b.release_angle, entry = b.entry_angle, peak = b.apex_pos.y, above = peak - rimY;
    const vp = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const tm = this.scene.getTransformMatrix(), sc = this.canvas.clientWidth / this.engine.getRenderWidth();
    [[anchors.launch, `Launch ${Math.round(launch)}°`], [anchors.apex, `Peak ${peak.toFixed(2)} m`], [anchors.entry, `Entry ${Math.round(entry)}°`]].forEach(([p, txt], i) => {
      const el = this.shotLabels[i], sp = BABYLON.Vector3.Project(new BABYLON.Vector3(p.x, p.y, p.z), BABYLON.Matrix.IdentityReadOnly, tm, vp);
      if (sp.z > 0 && sp.z < 1) { el.style.display = 'block'; el.textContent = txt; el.style.transform = `translate(${sp.x * sc}px, ${sp.y * sc}px) translate(-50%,-50%)`; }
      else el.style.display = 'none';
    });
    // the card: numbers plus a one-line read of the arc
    // same band as the grey arcs: 38-52° entry is good, 45° ideal
    const verdict = entry > 52 ? ['warn', 'Very high - outside the band, a little flatter is fine'] : entry >= 45 ? ['good', 'High arc - lots of room in the ring'] :
      entry >= 38 ? ['good', 'Good arc - inside the band'] : entry >= 35 ? ['warn', 'A bit flat - shoot up more'] : ['bad', 'Flat - shoot up, over the front of the rim'];
    const key = `${launch.toFixed(1)}|${entry.toFixed(1)}|${peak.toFixed(2)}`;
    if (key !== this._shotKey) {
      this._shotKey = key;
      card.innerHTML = `<div class="sc-h">Made shot</div><div class="sc-row"><span><b>${Math.round(launch)}°</b>launch</span><span><b>${peak.toFixed(2)} m</b>peak · ${above.toFixed(2)} m over ring</span><span><b>${Math.round(entry)}°</b>entry</span></div><div class="sc-v ${verdict[0]}">${verdict[1]}</div>`;
    }
    const f = this.freeRect || this.measureFree();
    card.style.left = `${(f.x0 + f.x1) / 2}px`; card.style.top = `${f.y0 + 10}px`;
    card.classList.add('show');
  }
  /**
   * Arcs from the release point to the centre of the ring that enter at 45° (ideal) and at 38° / 52°
   * (the edges of the acceptable range). No drag: tan(launch) = tan(entry) + 2·rise/distance.
   */
  guidePaths() {
    const b = this.core.ball, rim = this.core.rim, p0 = b.p0, key = `${p0.x},${p0.y},${p0.z},${rim.y}`;
    if (this._guide && this._guide.key === key) return this._guide.paths;
    const d = new V3(rim.x - p0.x, 0, rim.z - p0.z), D = d.len(), dy = rim.y - p0.y, u = d.mul(1 / D), N = Overlays.GUIDE_N, g = C.GRAVITY;
    const path = (entry) => {
      const th = Math.atan(Math.tan(entry * DEG) + 2 * dy / D), v = BallPhysics.launchVelocity(p0, rim, th / DEG);
      const vh = Math.hypot(v.x, v.z), T = D / vh;
      return Array.from({ length: N }, (_, i) => { const t = T * i / (N - 1); return p0.add(u.mul(vh * t)).add(new V3(0, v.y * t - 0.5 * g * t * t, 0)); });
    };
    const paths = { opt: path(45), lo: path(38), hi: path(52) };
    this._guide = { key, paths };
    return paths;
  }
  updateAngles(phase) {
    const c = this.core, labels = this.angleLabels;
    let k = 0;
    if (this.showAngles && this.camMode !== 'first') {   // overlays would sit in the player's face in first person
      const vp = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
      const tm = this.scene.getTransformMatrix(), sc = this.canvas.clientWidth / this.engine.getRenderWidth();
      for (const ch of phase.checks) {
        if (!TRIPLE[ch.metric] || k >= 3) continue;
        const res = c.checks({ checks: [ch] })[0];
        if (res.value == null) continue;
        const [a, b, cc] = TRIPLE[ch.metric].map((n) => c.avatar.world(`${n}_${c.avatar.side}`));
        const anchor = this.overlays.setArc(k, a, b, cc, res.ok, 0.10 * this.s.player_height / 1.6);
        const sp = BABYLON.Vector3.Project(new BABYLON.Vector3(anchor.x, anchor.y, anchor.z), BABYLON.Matrix.IdentityReadOnly, tm, vp);
        const el = labels[k];
        if (sp.z > 0 && sp.z < 1) {
          el.style.display = 'block'; el.textContent = `${Math.round(res.value)}°`;
          el.style.color = res.ok ? 'var(--good)' : 'var(--bad)';
          el.style.transform = `translate(${sp.x * sc}px, ${sp.y * sc}px) translate(-50%,-50%)`;
        } else el.style.display = 'none';
        k++;
      }
    }
    for (let i = k; i < 3; i++) { this.overlays.setArc(i, null); labels[i].style.display = 'none'; }
  }

  // ---------------------------------------------------------------- HUD
  buildHud() {
    this.shotLabels = [0, 1, 2].map((i) => { const d = document.createElement('div'); d.className = `ang shotlbl${i === 1 ? ' peak' : ''}`; document.body.appendChild(d); return d; });
    this.angleLabels = [0, 1, 2].map(() => { const d = document.createElement('div'); d.className = 'ang'; d.style.left = '0'; d.style.top = '0'; document.body.appendChild(d); return d; });
    for (const sel of [$('skillSel'), $('mSkill')]) {
      sel.innerHTML = this.skills.order.map((k) => { const sk = this.skills.skills.find((x) => x.key === k); return `<option value="${k}">${sk.name}</option>`; }).join('');
      sel.addEventListener('change', (e) => { this.setSkill(e.target.value); e.target.blur(); });
    }
    const cb = $('camBtns');
    cb.innerHTML = CAM_MODES.map((n, i) => `<button data-cmode="${n}" title="${CAM_HINTS[n]} (${i + 1})">${CAM_LABELS[n]}<kbd>${i + 1}</kbd></button>`).join('');
    cb.querySelectorAll('[data-cmode]').forEach((b) => b.addEventListener('click', (e) => { this.setCamMode(b.dataset.cmode); e.currentTarget.blur(); }));
    const on = (id, f) => $(id).addEventListener('click', (e) => { f(e); e.currentTarget.blur(); });
    on('bPlay', () => this.playPause()); on('bNext', () => this.stepNext()); on('bPrev', () => this.stepPrev());
    on('bSpeed', () => this.toggleSpeedPop());
    on('exitTrainer', () => this.setCamMode(this.autoCam ? 'auto' : 'third'));
    on('bAngles', () => { this.showAngles = !this.showAngles; });
    on('bLine', () => { this.forceLine = !this.forceLine; });
    on('bTrail', () => { this.trailOn = !this.trailOn; });
    on('bHand', () => this.toggleHand());
    on('bSettings', () => $('settings').classList.toggle('open'));
    on('bHelp', () => $('help').classList.add('open'));
    $('help').addEventListener('click', () => $('help').classList.remove('open'));
    // timeline scrubbing
    const tl = $('timeline');
    const scrub = (e) => {
      const r = tl.getBoundingClientRect(), u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.playing = false; this.stopAt = null; this.core.seek(u * this.core.end_time);
      const [i] = this.core.timeline.segment(this.core.t), ph = this.core.display_skill.phases[i], b = $('tlBubble');
      b.textContent = `${i + 1}. ${ph.title}`;
      b.style.left = `${Math.max(70, Math.min(r.width - 70, u * r.width))}px`;
    };
    tl.addEventListener('pointerdown', (e) => { tl.setPointerCapture(e.pointerId); this._scrub = true; scrub(e); this.phone && this.phone.showBubble(true); });
    tl.addEventListener('pointermove', (e) => { if (this._scrub) scrub(e); });
    const endScrub = () => { this._scrub = false; this.phone && this.phone.showBubble(false); };
    tl.addEventListener('pointerup', endScrub); tl.addEventListener('pointercancel', endScrub);
    this.bindSettings();
    this.hudBuilt = true;
    this.rebuildHudSkill();
  }
  rebuildHudSkill() {
    const c = this.core, sk = c.display_skill;
    $('skillSel').value = $('mSkill').value = c.skill.key;
    $('mnemonic').textContent = sk.mnemonic || sk.summary;
    $('phases').innerHTML = sk.phases.map((p, i) => `<li data-i="${i}"><span class="n">${i + 1}</span>${p.title}</li>`).join('');
    $('phases').querySelectorAll('li').forEach((li) => li.addEventListener('click', () => this.gotoPhase(+li.dataset.i)));
    const T = c.end_time, ticks = c.timeline.times.slice(0, -1).map((t, i) =>
      `<div class="tk" style="left:${t / T * 100}%"></div><div class="lab" style="left:${t / T * 100}%">${i + 1}</div>`);
    if (c.timeline.release_time != null) ticks.push(`<div class="tk rel" style="left:${c.timeline.release_time / T * 100}%" title="Release"></div>`);
    $('tlTicks').innerHTML = ticks.join('');
    this._hudIdx = -1;
  }
  updateHud(idx, phase, rawDt) {
    const c = this.core, n = c.display_skill.phases.length;
    if (idx !== this._hudIdx) {
      this._hudIdx = idx;
      $('phaseNo').textContent = `Phase ${idx + 1} of ${n} · ${c.display_skill.short_name || c.display_skill.name}`;
      $('mPhase').textContent = `${idx + 1}/${n}`;
      $('phaseTitle').textContent = phase.title;
      $('why').textContent = phase.why;
      // cues read "short cue — what it means": the cue in bold, the explanation after it
      $('cues').innerHTML = phase.cues.map((x) => { const [c, more] = x.split(' — '); return `<li><b>${c}</b>${more ? `<span class="more"> — ${more}</span>` : ''}</li>`; }).join('');
      // faults read "problem → fix": show the fix on its own line
      $('faults').innerHTML = phase.faults.map((x) => { const [f, fix] = x.split(' → '); return `<li>${f}${fix ? `<span class="fix">${fix[0].toUpperCase() + fix.slice(1)}</span>` : ''}</li>`; }).join('');
      const dr = phase.drill || '', di = dr.indexOf(': ');
      $('drill').innerHTML = di > 0 && di < 40 ? `<b>${dr.slice(0, di)}</b> – ${dr.slice(di + 2)}` : dr;
      $('drillSec').style.display = $('drill').style.display = dr ? '' : 'none';
      $('checks').innerHTML = phase.checks.map((ch) => `<div class="chk"><span class="l">${ch.label}</span><span class="v"></span><div class="rng"><i></i><b></b></div></div>`).join('') || '<div style="color:var(--dim);font-size:13px">–</div>';
      this._chkEls = [...$('checks').querySelectorAll('.chk')];
      if (this.phone && this.phone.layoutSheet) this.phone.layoutSheet();   // part heights changed
      $('phases').querySelectorAll('li').forEach((li, i) => { li.classList.toggle('cur', i === idx); li.classList.toggle('done', i < idx); });
    }
    const res = c.checks(phase);
    const okN = res.filter((r) => r.ok).length, badge = $('badge');
    badge.textContent = res.length ? `${okN}/${res.length} ✓` : '';
    badge.classList.toggle('bad', okN < res.length);
    res.forEach((r, i) => {
      const el = this._chkEls[i]; if (!el) return;
      el.classList.toggle('bad', !r.ok);
      el.querySelector('.v').textContent = fmt(r.value, r.unit);
      const lo = r.lo ?? 0, hi = r.hi ?? (r.lo != null ? r.lo * 2 : 100), span = (hi - lo) || 1, a = lo - span * 0.6, b = hi + span * 0.6;
      const P = (v) => `${Math.max(0, Math.min(100, (v - a) / (b - a) * 100))}%`;
      const band = el.querySelector('i'); band.style.left = P(r.lo ?? a); band.style.right = `calc(100% - ${P(r.hi ?? b)})`;
      const mk = el.querySelector('b'); mk.style.display = r.value == null ? 'none' : 'block'; if (r.value != null) mk.style.left = P(r.value);
    });
    const u = c.t / c.end_time;
    $('tlFill').style.width = `${u * 100}%`; $('tlHead').style.left = `${u * 100}%`;
    $('bPlay').textContent = this.playing ? '⏸' : '▶'; $('bPlay').setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    $('speedVal').textContent = `${SPEEDS[this.speedI]}×`;
    document.querySelectorAll('[data-cmode]').forEach((b) => b.classList.toggle('on', b.dataset.cmode === this.camMode));
    const tg = (id, v) => $(id).classList.toggle('on', v);
    tg('bAngles', this.showAngles); tg('bLine', this.forceLine); tg('bTrail', this.trailOn);
    $('bHand').firstChild.textContent = this.s.handedness === 'left' ? 'Left' : 'Right';
    // status line
    const st = `<b>${this.playing ? 'Playing' : 'Paused'}</b>${!this.playing ? ' · ▶ plays the whole skill, ⏭ the next phase' : ''}`;
    const cam = this.trainer.active ? `Coach view${this.trainer.noclip ? ' (noclip)' : ''} · FOV ${this.trainer.fov}°` : this.camMode === 'auto' ? `Auto camera · ${LABELS[this.cam.preset]}` : CAM_LABELS[this.camMode];
    const html = `<span>${st}</span><span>${cam}</span><span>Player <b>${this.s.player_height.toFixed(2)} m</b> · ${this.s.handedness}-handed · size ${this.s.ball_size}</span>` +
      `<span class="desk">Rim ${this.s.rim_height.toFixed(2)} m · release <b>${Math.round(c.angle)}°</b> · entry ${Math.round(c.ball.entry_angle || 0)}°</span>`;
    if (html !== this._st) { $('status').innerHTML = html; this._st = html; }
    if (this.phone) this.phone.update();
    // fps
    this._fpsAcc = (this._fpsAcc || 0) + rawDt; this._fpsN = (this._fpsN || 0) + 1;
    if (this._fpsAcc > 0.5) {
      const fps = this._fpsN / this._fpsAcc, el = $('fps');
      el.textContent = `${Math.round(fps)} fps · ${this.engine.hoopformBackend}`;
      el.style.color = fps >= 50 ? '#8a8f99' : fps >= 30 ? '#e0a030' : '#ff5a4a';
      this._fpsAcc = 0; this._fpsN = 0;
      // auto lite mode: if it stays under 30 fps for ~3 s, drop the expensive effects once
      if (this.s.lite === 'auto' && !this.autoLite && !this.liteForce && performance.now() > this._fpsHold && document.visibilityState === 'visible') {
        this._fpsLow = fps < 30 ? (this._fpsLow || 0) + 1 : 0;
        if (this._fpsLow >= 6) {
          this.autoLite = true; this.buildWorld();
          this.flash('Lite mode on for smoother play · change it under ⋯ › Screen');
        }
      }
    }
  }
  flash(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(this._toast); this._toast = setTimeout(() => t.classList.remove('show'), 2600); }
  bindSettings() {
    const s = this.s, save = () => store.set('settings', s);
    const sync = () => {
      $('sHeight').value = s.player_height; $('vHeight').textContent = `${s.player_height.toFixed(2)} m`;
      $('sRim').value = s.rim_height; $('vRim').textContent = `${s.rim_height.toFixed(2)} m`;
      $('sBall').value = String(s.ball_size);
      $('sAngle').value = s.release_angle || 0; $('vAngle').textContent = s.release_angle ? `${s.release_angle}°` : 'auto';
      $('sShadows').classList.toggle('on', !!s.shadows); $('sCrowd').classList.toggle('on', !!s.crowd); $('sReflect').classList.toggle('on', !!s.reflections);
    };
    sync();
    const live = (id, f) => $(id).addEventListener('input', (e) => { f(e.target.value); sync(); });
    const commit = (id, f) => $(id).addEventListener('change', () => { f(); save(); });
    live('sHeight', (v) => { s.player_height = +v; }); commit('sHeight', () => this.buildPlayer());
    live('sRim', (v) => { s.rim_height = +v; }); commit('sRim', () => this.buildWorld());
    live('sAngle', (v) => { s.release_angle = +v >= 35 ? +v : null; }); commit('sAngle', () => this.buildPlayer());
    $('sBall').addEventListener('change', (e) => { s.ball_size = +e.target.value; save(); sync(); this.buildPlayer(); });
    $('sShadows').addEventListener('click', () => { s.shadows = !s.shadows; save(); sync(); this.buildWorld(); });
    $('sCrowd').addEventListener('click', () => { s.crowd = !s.crowd; save(); sync(); this.buildWorld(); });
    $('sReflect').addEventListener('click', () => { s.reflections = !s.reflections; save(); sync(); this.buildWorld(); });
    $('sReset').addEventListener('click', () => { Object.assign(s, C.defaultSettings(), { skill: s.skill }); save(); sync(); this.buildWorld(); });
  }

  // ---------------------------------------------------------------- actions
  setSkill(key) {
    this.core.loadSkill(key);
    this.s.skill = key; store.set('settings', this.s);
    this.buildPlayer(false);
    this.playing = this.mode === 'continuous'; this.stopAt = null;
    this.flash(this.core.display_skill.name);
  }
  nextSkill() { const o = this.skills.order; this.setSkill(o[(o.indexOf(this.core.skill.key) + 1) % o.length]); }
  /** auto · third (orbit camera that follows the player) · first (the player's eyes) · coach (walk around) */
  setCamMode(m, quiet = false) {
    if (!CAM_MODES.includes(m)) return;
    if (m === 'coach') { this.camMode = 'coach'; this.setTrainer(true); return; }
    if (this.trainer.active) this.setTrainer(false, true);
    this.camMode = m;
    if (m === 'auto') { this.autoCam = true; this.cam.user_override = false; this.cam.setPreset(this.cam.preset); }
    else { this.autoCam = false; this.cam.user_override = true; }            // third: start from the current view
    if (m === 'first') { this.fp.yaw = 0; this.fp.pitch = 0; this.fp.dir = null; }
    if (!quiet) this.flash(CAM_HINTS[m]);
  }
  cycleCamMode() { this.setCamMode(CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]); }
  setCam(name) { this.setCamMode('third', true); this.cam.setPreset(name); this.cam.user_override = false; }
  toggleAuto() { this.setCamMode(this.camMode === 'auto' ? 'third' : 'auto'); }
  orbitView(dyaw, dpitch) {
    if (this.camMode === 'first') { this.fp.yaw = Math.max(-100, Math.min(100, this.fp.yaw + dyaw * 0.6)); this.fp.pitch = Math.max(-60, Math.min(60, this.fp.pitch + dpitch * 0.6)); }
    else this.cam.orbit(dyaw, dpitch);
  }
  zoomView(f) {
    if (this.camMode === 'first') this.fp.fov = Math.max(40, Math.min(100, this.fp.fov * f));
    else this.cam.zoom(f);
  }
  /** the player's own view: from the eyes, along the head (it follows the look at the rim), smoothed */
  firstPersonPose(dt) {
    const av = this.core.avatar, w = av.j.head.world(), eye = av.markers.eye.worldPos();
    let f = new BABYLON.Vector3(w[8], w[9], w[10]); f.normalize();
    if (!this.fp.dir) this.fp.dir = f.clone();
    this.fp.dir = BABYLON.Vector3.Lerp(this.fp.dir, f, 1 - Math.exp(-dt * 10)); this.fp.dir.normalize();
    const d = this.fp.dir, yaw = Math.atan2(d.x, d.z) / DEG, pitch = -Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG;
    const pos = eye.add(new eye.constructor(d.x, d.y, d.z).mul(0.03 * this.s.player_height));
    const view = { pos, yaw: yaw + this.fp.yaw, pitch: Math.max(-80, Math.min(80, pitch + this.fp.pitch)) };
    // landscape: centre the view in the area the panels leave free; portrait: fit the width
    return innerWidth >= innerHeight ? { ...view, vfov: this.fp.fov * 0.8 } : { ...view, hfov: this.fp.fov };
  }
  toggleHand() { this.s.handedness = this.s.handedness === 'left' ? 'right' : 'left'; store.set('settings', this.s); this.buildPlayer(); this.flash(`${this.s.handedness === 'left' ? 'Left' : 'Right'}-handed shooter`); }

  // speed list that pops up from the speed button (closes on pick, outside tap or Esc)
  toggleSpeedPop(open) {
    const pop = $('speedPop'), btn = $('bSpeed'), show = open ?? !pop.classList.contains('open');
    if (pop.parentElement !== document.body) document.body.appendChild(pop);   // out of the blurred bar (it would trap position: fixed)
    if (!show) { pop.classList.remove('open'); btn.classList.remove('open'); return; }
    pop.innerHTML = '<div class="hd">Speed</div>' + SPEEDS.slice().reverse().map((v) => {
      const i = SPEEDS.indexOf(v); return `<button data-i="${i}" class="${i === this.speedI ? 'cur' : ''}" role="menuitemradio">${v === 1 ? '1× real' : `${v}×`}</button>`; }).join('');
    pop.querySelectorAll('button').forEach((b) => b.onclick = (e) => { e.stopPropagation(); this.changeSpeed(+b.dataset.i - this.speedI); this.toggleSpeedPop(false); });
    pop.classList.add('open'); btn.classList.add('open');
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    pop.style.top = `${Math.max(8, r.top - h - 8)}px`;
    if (!this._popOff) {
      this._popOff = true;
      document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#speedPop, #bSpeed')) this.toggleSpeedPop(false); }, true);
      addEventListener('keydown', (e) => { if (e.key === 'Escape') this.toggleSpeedPop(false); });
      addEventListener('resize', () => this.toggleSpeedPop(false));
    }
  }
  changeSpeed(d) { this.speedI = Math.max(0, Math.min(SPEEDS.length - 1, this.speedI + d)); this.s.playback_speed = SPEEDS[this.speedI]; store.set('settings', this.s); }
  // ▶ always plays the whole skill on repeat from where it is; ⏭ / ⏮ step one phase at a time
  playPause() {
    if (this.playing) { this.playing = false; return; }
    if (this.core.t >= this.core.end_time - 1e-6) this.core.seek(0);
    this.mode = 'continuous'; this.stopAt = null; this.playing = true;
  }
  phaseEnd(i) { return this.core.timeline.times[i + 1]; }
  stepNext() {
    const c = this.core;
    if (this.mode !== 'step') { this.mode = 'step'; }
    const [idx] = c.timeline.segment(c.t), n = c.skill.phases.length, atEnd = c.t >= this.phaseEnd(idx) - 1e-6;
    if (c.t >= c.end_time - 1e-6 || (idx === n - 1 && atEnd && c.t >= c.timeline.total)) { c.seek(0); this.stopAt = this.phaseEnd(0); this.playing = true; return; }
    if (c.t <= 1e-6) this.stopAt = this.phaseEnd(0);
    else if (atEnd) this.stopAt = idx + 1 < n ? this.phaseEnd(idx + 1) : c.end_time;
    else this.stopAt = this.phaseEnd(idx);
    if (this.stopAt >= c.timeline.total - 1e-6) this.stopAt = c.end_time;
    this.playing = true;
  }
  stepPrev() {
    const c = this.core; this.mode = 'step'; this.playing = false;
    let [idx] = c.timeline.segment(c.t);
    if (c.t <= c.timeline.times[idx] + 0.05 || c.t >= c.end_time - 1e-6) idx = Math.max(0, idx - (c.t >= c.timeline.total ? 0 : 1));
    c.seek(c.timeline.times[idx]); this.stopAt = null;
  }
  gotoPhase(i) { this.mode = 'step'; this.core.seek(this.core.timeline.times[i]); this.stopAt = this.phaseEnd(i); this.playing = true; }
  restart() { this.core.seek(0); this.playing = true; this.stopAt = this.mode === 'step' ? this.phaseEnd(0) : null; }
  setTrainer(on, quiet = false) {
    if (on === this.trainer.active) return;
    if (on) this.camMode = 'coach'; else if (this.camMode === 'coach') this.camMode = this.autoCam ? 'auto' : 'third';
    document.body.classList.toggle('trainer', on);
    if (on) {
      this.trainer.enter(this.core.focus());
      this.lockPointer();
      this.flash(TOUCH ? 'Touch the left side to move · drag on the right to look' : 'Walk around: WASD run · Shift walk · R-click jump · Ctrl crouch · N noclip · F/Esc exit');
    } else {
      this.trainer.active = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.cam.setPreset(this.cam.preset, true); if (this.camMode === 'third') this.cam.user_override = true;
      if (!quiet) this.flash(CAM_HINTS[this.camMode]);
    }
    $('lookHint').style.display = 'none';
  }
  lockPointer() {
    if (TOUCH || !this.canvas.requestPointerLock) return;
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* not allowed */ } };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); });
    } catch { plain(); }   // drag-to-look still works when the frame forbids pointer lock
  }
  trainerInput() {
    const k = this.keys, st = this.stick || { x: 0, y: 0 };
    const ax = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    let fb = ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown'), lr = ax('KeyD', 'KeyA');
    fb = Math.max(-1, Math.min(1, fb - st.y)); lr = Math.max(-1, Math.min(1, lr + st.x));
    const ctrl = k.has('ControlLeft') || k.has('ControlRight') || this.touchCrouch;
    return { fb, lr, slow: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchWalk, crouch: ctrl,
      up: k.has('KeyE') || this.rmb || this.touchUp, down: k.has('KeyQ') || ctrl };
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const cv = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code) || (e.ctrlKey && this.trainer.active)) e.preventDefault();
      if (e.repeat && !['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'BracketLeft', 'BracketRight'].includes(e.code)) return;
      this.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.rmb = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (this.trainer.active && !document.pointerLockElement && !TOUCH) $('lookHint').style.display = 'block';
      else $('lookHint').style.display = 'none';
    });
    // pointers. Mouse: drag orbits. Touch: one finger drags to turn the camera around the player
    // or taps to play / pause; two fingers orbit (drag) and zoom (pinch). Walking around: one finger looks.
    const pts = new Map();
    let pinch = null, mid = null, gest = null;
    const midOf = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.focus({ preventScroll: true });
      $('settings').classList.remove('open');
      if (this.trainer.active && e.pointerType === 'mouse') {
        if (e.button === 2) { this.rmb = true; if (!this.trainer.noclip) this.trainer.jump(); }
        if (!document.pointerLockElement) { this.lockPointer(); $('lookHint').style.display = 'none'; }
      }
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType === 'touch') {
        if (pts.size === 1) gest = { x0: e.clientX, y0: e.clientY, multi: false };
        else if (gest) gest.multi = true;
      }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); mid = midOf(); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.trainer.active && document.pointerLockElement === cv) { this.trainer.look(e.movementX, e.movementY); return; }
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = midOf();
        if (pinch && d > 0) { if (this.trainer.active) this.trainer.fov = Math.max(30, Math.min(120, this.trainer.fov * pinch / d)); else this.zoomView(pinch / d); }
        if (mid && !this.trainer.active) this.orbitView((m.x - mid.x) * 0.35, (m.y - mid.y) * 0.25);
        pinch = d; mid = m; return;
      }
      if (this.trainer.active) this.trainer.look(dx, dy, e.pointerType === 'mouse' ? 0.2 : this.s.look_sens);
      else if (e.pointerType !== 'touch') this.orbitView(dx * 0.35, dy * 0.25);
      else if (gest && !gest.multi) {                     // one finger: turn the view once it is clearly a drag, not a tap
        if (!gest.moved && Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) >= 12) gest.moved = true;
        if (gest.moved) this.orbitView(dx * 0.35, dy * 0.25);
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) { pinch = null; mid = null; } if (e.button === 2) this.rmb = false;
      if (e.pointerType === 'touch' && gest && pts.size === 0) {
        const g = gest; gest = null;
        if (g.multi || this.trainer.active || e.type === 'pointercancel') return;
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        // a tap (no real movement) plays / pauses; a drag already turned the camera
        if (!g.moved && Math.hypot(dx, dy) < 12) this.playPause();
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.trainer.active) this.trainer.changeFov(e.deltaY > 0 ? 1 : -1);
      else this.zoomView(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }
  toggleNoclip() {
    const on = this.trainer.toggleNoclip(this.core.focus(), STANCHIONS);
    $('tJump').textContent = on ? 'UP' : 'JUMP'; $('tCrouch').textContent = on ? 'DOWN' : 'CROUCH';
    this.flash(on ? 'Noclip: fly anywhere (up / down to rise and sink)' : 'Noclip off');
  }
  onKey(e) {
    const k = e.code;
    if ($('help').classList.contains('open')) { $('help').classList.remove('open'); if (k === 'Escape') return; }
    if (e.key === '?' || k === 'Slash') { $('help').classList.add('open'); return; }
    if (this.trainer.active) {
      if (k === 'KeyF' || k === 'Escape' || k === 'Digit4') { this.setTrainer(false); return; }
      if (k === 'KeyN') { this.toggleNoclip(); return; }
      if (k === 'BracketLeft' || k === 'BracketRight') { this.trainer.changeFov(k === 'BracketRight' ? 1 : -1); return; }
      if (/^Digit[1-3]$/.test(k)) { this.setCamMode(CAM_MODES[+k.slice(5) - 1]); return; }
      if (k === 'Space') this.playPause();
      return;                                   // WASD etc. are movement
    }
    switch (k) {
      case 'Space': this.playPause(); break;
      case 'ArrowRight': case 'KeyD': this.stepNext(); break;
      case 'ArrowLeft': this.stepPrev(); break;
      case 'KeyK': this.nextSkill(); break;
      case 'Equal': case 'NumpadAdd': this.changeSpeed(1); break;
      case 'Minus': case 'NumpadSubtract': this.changeSpeed(-1); break;
      case 'KeyC': this.cycleCamMode(); break;
      case 'KeyF': this.setCamMode('coach'); break;
      case 'BracketLeft': case 'BracketRight':
        this.cam.fov_offset = Math.max(-25, Math.min(40, this.cam.fov_offset + (k === 'BracketRight' ? 5 : -5)));
        if (this.camMode === 'first') { this.zoomView(k === 'BracketRight' ? 1.1 : 1 / 1.1); this.flash(`Field of view ${Math.round(this.fp.fov)}°`); break; }
        this.flash(`Field of view ${Math.round(this.cam.fov + this.cam.fov_offset)}°`); break;
      case 'KeyH': this.toggleHand(); break;
      case 'KeyL': this.forceLine = !this.forceLine; break;
      case 'KeyT': this.trailOn = !this.trailOn; break;
      case 'KeyA': this.showAngles = !this.showAngles; break;
      case 'KeyR': this.restart(); break;
      case 'Escape': $('settings').classList.remove('open'); break;
      default: if (/^Digit[1-4]$/.test(k)) this.setCamMode(CAM_MODES[+k.slice(5) - 1]);
    }
  }
}

const app = new App();
window.hoopform = app;
app.start().catch((err) => {
  console.error(err);
  const m = document.getElementById('loadMsg');
  if (m) m.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
});
