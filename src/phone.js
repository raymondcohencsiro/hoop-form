// Phone / touch interface: coaching sheet with snap heights, options sheet, camera
// cycling, timeline bubble, first-run tour, rotate hint, full screen, floating
// walk-around joystick, run toggle, tilt-to-look, wake lock and the bottom-bar height.
// Desktop keeps its own layout; everything here is driven by CSS media queries plus
// touch-only behaviour.
import { CAM_MODES, CAM_LABELS } from './cameras.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('hoopform.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('hoopform.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const portrait = () => matchMedia('(max-width: 820px) and (min-height: 561px)').matches;
const landscapePhone = () => matchMedia('(max-height: 560px)').matches;
// portrait coaching sheet: 'head' (title only) or 'open' (title + one section; swipe for the others)
const SHEET = (v) => (v === 'head' || v === 'peek' ? 'head' : 'open');
const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1.0];

// simple line drawings for the tour cards (no text inside)
const ART = {
  swipe: '<svg viewBox="0 0 132 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="8" width="72" height="80" rx="10" opacity=".35"/><path d="M48 52h36"/><path d="M48 52l8-8M48 52l8 8"/><path d="M84 52l-8-8M84 52l-8 8"/><circle cx="66" cy="34" r="6"/></svg>',
  tap: '<svg viewBox="0 0 132 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="8" width="72" height="80" rx="10" opacity=".35"/><circle cx="66" cy="48" r="7"/><circle cx="66" cy="48" r="16" opacity=".55"/><circle cx="66" cy="48" r="25" opacity=".25"/></svg>',
  two: '<svg viewBox="0 0 132 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="8" width="72" height="80" rx="10" opacity=".35"/><circle cx="54" cy="52" r="6"/><circle cx="78" cy="52" r="6"/><path d="M44 30c14-10 30-10 44 0"/><path d="M88 30l-2-9M88 30l-9 1"/></svg>',
  more: '<svg viewBox="0 0 132 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><rect x="30" y="8" width="72" height="80" rx="10" opacity=".35"/><rect x="40" y="66" width="52" height="14" rx="5"/><circle cx="56" cy="73" r="1.5"/><circle cx="66" cy="73" r="1.5"/><circle cx="76" cy="73" r="1.5"/></svg>',
};
const TOUR = [
  ['swipe', 'Drag to look around', 'Drag one finger on the court to turn the camera around the player. ⏮ and ⏭ change the phase. Swipe the coaching panel for the cues, why, checkpoints, faults and a drill.'],
  ['tap', 'Tap to play or pause', 'Tap the court to play or pause. ▶ plays the whole skill on repeat; ⏭ and ⏮ step one phase at a time.'],
  ['two', 'Two fingers move the camera', 'Drag with two fingers to turn around the player, pinch to zoom. The camera button switches views.'],
  ['more', 'Everything else is under ⋯', 'Speed, cameras, angles, left-handed shooting, walking around the court and settings.'],
];

export function installPhoneUI(app) {
  const ui = { snap: 'half', autoCollapsed: false, prevSnap: null, wasPlaying: false };
  const right = $('right');

  // ---------------------------------------------------------------- bottom-bar height -> sheet position
  const setBar = () => {
    const b = $('bottom').getBoundingClientRect();
    document.documentElement.style.setProperty('--barH', `${Math.round(innerHeight - b.top + 6)}px`);
  };
  new ResizeObserver(setBar).observe($('bottom'));
  addEventListener('resize', setBar); setBar();

  // ---------------------------------------------------------------- coaching sheet
  const pages = $('pages'), tabs = $('tabs'), pageEls = [...pages.querySelectorAll('.page')];
  tabs.innerHTML = pageEls.map((p, i) => `<button role="tab" data-i="${i}">${p.dataset.tab}</button>`).join('');
  const tabBtns = [...tabs.querySelectorAll('button')];
  ui.page = Math.max(0, Math.min(pageEls.length - 1, store.get('page') ?? 0));
  const pageW = () => pages.clientWidth || 1;
  const fitPage = () => {                            // the sheet grows or shrinks to the section on show
    if (!portrait() || ui.snap !== 'open') { pages.style.height = ''; return; }
    const el = pageEls[ui.page];
    pages.style.height = `${Math.ceil(Math.min(el.scrollHeight, el.getBoundingClientRect().height || el.scrollHeight))}px`;
  };
  const showPage = (i, smooth = true) => {
    ui.page = Math.max(0, Math.min(pageEls.length - 1, i)); store.set('page', ui.page);
    tabBtns.forEach((b, k) => { b.classList.toggle('on', k === ui.page); b.setAttribute('aria-selected', String(k === ui.page)); });
    if (portrait() && Math.abs(pages.scrollLeft - ui.page * pageW()) > 2) pages.scrollTo({ left: ui.page * pageW(), behavior: smooth ? 'smooth' : 'auto' });
    fitPage();
  };
  tabBtns.forEach((b) => b.onclick = () => showPage(+b.dataset.i));
  let scrollT = 0;
  pages.addEventListener('scroll', () => {           // swipe: follow the section under the finger
    if (!portrait()) return;
    const i = Math.round(pages.scrollLeft / pageW());
    if (i !== ui.page) { ui.page = i; store.set('page', i); tabBtns.forEach((b, k) => b.classList.toggle('on', k === i)); fitPage(); }
    clearTimeout(scrollT); scrollT = setTimeout(fitPage, 150);   // never scroll here: it would fight the finger; scroll-snap settles it
  }, { passive: true });
  const layout = () => {
    if (!portrait()) { pages.style.height = ''; pages.scrollLeft = 0; pageEls.forEach((p) => { p.scrollTop = 0; }); return; }
    right.style.maxHeight = '';
    if (ui.snap === 'open') requestAnimationFrame(() => showPage(ui.page, false));
  };
  const setSnap = (s, user = false) => {
    ui.snap = SHEET(s); right.dataset.snap = ui.snap;
    if (user) ui.autoCollapsed = false;          // the person's choice wins until the next play
    layout();
  };
  ui.layoutSheet = () => { if (portrait() && ui.snap === 'open') requestAnimationFrame(fitPage); };
  ui.setSnap = setSnap; ui.showPage = showPage;
  setSnap(store.get('sheet') || 'open');
  addEventListener('resize', () => requestAnimationFrame(layout));
  const head = $('sheetHead');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (!portrait()) return;
    drag = { y0: e.clientY, moved: false, id: e.pointerId };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = e.clientY - drag.y0;
    if (Math.abs(drag.dy) > 12) drag.moved = true;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) setSnap(drag.dy < 0 ? 'open' : 'head', true);          // drag up opens, down closes
    else setSnap(ui.snap === 'open' ? 'head' : 'open', true);              // tap toggles
    store.set('sheet', ui.snap);
    drag = null;
  };
  head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag);

  // landscape: the coaching overlay can be dismissed and brought back
  const setCoachHidden = (h) => { right.classList.toggle('hidden', h); document.body.classList.toggle('coachhidden', h); store.set('coachHidden', h); app.refit(true); };
  $('sheetToggle').onclick = (e) => { e.currentTarget.blur(); setCoachHidden(true); };
  $('coachPill').onclick = () => setCoachHidden(false);
  if (store.get('coachHidden')) setCoachHidden(true);

  // ---------------------------------------------------------------- options sheet
  const more = $('more'), scrim = $('scrim');
  const openMore = (on) => { more.classList.toggle('open', on); scrim.classList.toggle('open', on); };
  $('bMore').onclick = () => openMore(!more.classList.contains('open'));
  $('moreClose').onclick = () => openMore(false);
  scrim.onclick = () => { openMore(false); $('settings').classList.remove('open'); };
  // cameras
  $('mCams').innerHTML = CAM_MODES.map((n) => `<button data-mcam="${n}">${CAM_LABELS[n]}</button>`).join('');
  $('mCams').querySelectorAll('button').forEach((b) => b.onclick = () => { if (b.dataset.mcam === 'coach') openMore(false); app.setCamMode(b.dataset.mcam); });
  // speed
  $('mSpeeds').innerHTML = SPEEDS.map((v, i) => `<button data-speed="${i}">${v}×</button>`).join('');
  $('mSpeeds').querySelectorAll('button').forEach((b) => b.onclick = () => app.changeSpeed(+b.dataset.speed - app.speedI));
  // show toggles
  const tgAct = { angles: () => { app.showAngles = !app.showAngles; }, line: () => { app.forceLine = !app.forceLine; }, trail: () => { app.trailOn = !app.trailOn; },
    tilt: () => toggleTilt() };
  document.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => tgAct[b.dataset.tg]());
  // player
  $('mHand').querySelectorAll('button').forEach((b) => b.onclick = () => { if (app.s.handedness !== b.dataset.hand) app.toggleHand(); });
  $('mSettings').onclick = () => { openMore(false); $('settings').classList.add('open'); scrim.classList.add('open'); };
  // walk around
  $('mWalk').onclick = () => { openMore(false); app.setCamMode('coach'); };
  const look = $('mLook');
  const syncLook = () => { look.value = app.s.look_sens; $('vLook').textContent = `${Math.round(app.s.look_sens / 0.25 * 100)}%`; };
  look.oninput = () => { app.s.look_sens = +look.value; syncLook(); };
  look.onchange = () => store.set('settings', app.s);
  syncLook();
  // screen
  const fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const toggleFull = () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const el = document.documentElement, p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => app.flash('Full screen isn’t available here')); }
    } catch { app.flash('Full screen isn’t available here'); }
  };
  $('mFull').onclick = toggleFull; $('mFull2').onclick = toggleFull;
  if (!fsOK) { $('mFull').style.display = 'none'; $('mFull2').style.display = 'none'; }
  // phones start maximised: browsers only allow full screen from a tap, so the first touch
  // anywhere (tour button, court, a control) switches it on. If the person leaves full screen
  // themselves, it isn't forced again this visit.
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (fsOK && app.touch && !isFull()) {
    const first = () => {
      removeEventListener('pointerdown', first, true);
      if (isFull()) return;
      try {
        const el = document.documentElement, p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => { /* not allowed here (e.g. inside a frame): stay windowed */ });
      } catch { /* not allowed here */ }
    };
    addEventListener('pointerdown', first, true);
  }
  const syncFullIcon = () => { $('mFull').textContent = isFull() ? '⤡' : '⛶'; $('mFull').title = isFull() ? 'Exit full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', () => { syncFullIcon(); app.refit(true); });
  document.addEventListener('webkitfullscreenchange', syncFullIcon);
  $('mTour').onclick = () => { openMore(false); startTour(); };
  $('mHelpAll').onclick = () => { openMore(false); $('help').classList.add('open'); };
  $('mHelp').onclick = (e) => { e.currentTarget.blur(); if (app.touch) startTour(); else $('help').classList.add('open'); };
  for (const seg of ['mLite', 'sLite']) $(seg).querySelectorAll('button').forEach((b) => b.onclick = () => app.setLite(b.dataset.lite));

  // ---------------------------------------------------------------- camera cycle button
  $('bCam').onclick = (e) => {
    e.currentTarget.blur();
    app.cycleCamMode();
  };

  // ---------------------------------------------------------------- timeline bubble
  const bubble = $('tlBubble');
  ui.showBubble = (on) => bubble.classList.toggle('show', on);

  // ---------------------------------------------------------------- tour + rotate hint
  let step = 0;
  const showStep = () => {
    const [art, title, text] = TOUR[step];
    $('tourArt').innerHTML = ART[art]; $('tourTitle').textContent = title; $('tourText').textContent = text;
    $('tourDots').innerHTML = TOUR.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
    $('tourNext').textContent = step === TOUR.length - 1 ? 'Start' : 'Next';
  };
  const endTour = () => { $('tour').classList.remove('open'); store.set('tourDone', true); maybeRotateHint(); };
  function startTour() { step = 0; showStep(); $('tour').classList.add('open'); }
  $('tourNext').onclick = () => { if (step < TOUR.length - 1) { step++; showStep(); } else endTour(); };
  $('tourSkip').onclick = endTour;
  function maybeRotateHint() {
    if (!app.touch || store.get('rotateDone') || !portrait()) return;
    $('rotate').classList.add('open');
  }
  $('rotateOk').onclick = () => { $('rotate').classList.remove('open'); store.set('rotateDone', true); };
  addEventListener('resize', () => { if ($('rotate').classList.contains('open') && !portrait()) { $('rotate').classList.remove('open'); store.set('rotateDone', true); } });
  if (app.touch && !store.get('tourDone')) setTimeout(startTour, 600);
  else setTimeout(maybeRotateHint, 800);

  // ---------------------------------------------------------------- walk around: floating stick, run, tilt
  const zone = $('stickZone'), stick = $('stick'), knob = $('knob');
  let sid = null, c0 = null;
  const place = (x, y) => { stick.style.left = `${x}px`; stick.style.top = `${y}px`; };
  zone.addEventListener('pointerdown', (e) => {
    sid = e.pointerId; zone.setPointerCapture(sid);
    c0 = { x: e.clientX, y: e.clientY }; place(c0.x, c0.y); stick.classList.add('active'); $('stickHint').style.display = 'none';
    app.stick = { x: 0, y: 0 };
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    const R = 68; let x = (e.clientX - c0.x) / R, y = (e.clientY - c0.y) / R; const L = Math.hypot(x, y); if (L > 1) { x /= L; y /= L; }
    app.stick = { x, y }; knob.style.transform = `translate(${x * R * 0.62}px, ${y * R * 0.62}px)`;
  });
  const endStick = (e) => {
    if (e.pointerId !== sid) return;
    sid = null; app.stick = { x: 0, y: 0 }; knob.style.transform = ''; stick.classList.remove('active');
    stick.style.left = ''; stick.style.top = '';
  };
  zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
  const hold = (id, set) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('held'); set(true); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { b.classList.remove('held'); set(false); });
  };
  hold('tJump', (v) => { app.touchUp = v && app.trainer.noclip; if (v && !app.trainer.noclip) app.trainer.jump(); });
  hold('tCrouch', (v) => { app.touchCrouch = v; });
  $('tNoclip').onclick = () => app.toggleNoclip();
  $('tRun').onclick = () => { app.touchWalk = !app.touchWalk; app.flash(app.touchWalk ? 'Walking pace' : 'Running pace'); };
  $('tTilt').onclick = () => toggleTilt();
  $('tFov').onclick = () => { app.trainer.fov = app.trainer.fov >= 110 ? 60 : app.trainer.fov + 10; };

  // tilt to look (gyroscope): turns the view by how much the phone turns
  ui.tilt = false; let last = null;
  const onOrient = (e) => {
    if (!ui.tilt || !app.trainer.active || e.alpha == null) { last = null; return; }
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const cur = { a: e.alpha, b: e.beta, g: e.gamma };
    if (last) {
      let da = cur.a - last.a; if (da > 180) da -= 360; if (da < -180) da += 360;
      let dp = ang === 90 ? cur.g - last.g : ang === -90 || ang === 270 ? last.g - cur.g : cur.b - last.b;
      if (Math.abs(dp) > 30) dp = 0;                         // gamma flips near vertical: ignore jumps
      app.trainer.yaw -= da;
      app.trainer.pitch = Math.max(-85, Math.min(85, app.trainer.pitch - dp));
    }
    last = cur;
  };
  addEventListener('deviceorientation', onOrient);
  async function toggleTilt() {
    if (!ui.tilt && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') { app.flash('Motion access was not allowed'); return; } } catch { app.flash('Tilt to look isn’t available here'); return; }
    }
    if (!ui.tilt && typeof DeviceOrientationEvent === 'undefined') { app.flash('Tilt to look isn’t available on this device'); return; }
    ui.tilt = !ui.tilt; last = null;
    app.flash(ui.tilt ? 'Tilt the phone to look around' : 'Tilt to look off');
  }

  // ---------------------------------------------------------------- keep the screen awake while playing
  let lock = null, pending = false;
  const wake = async (want) => {
    if (!('wakeLock' in navigator) || pending) return;
    if (want && !lock && document.visibilityState === 'visible') {
      pending = true;
      try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch { lock = null; } finally { pending = false; }
    } else if (!want && lock) { try { await lock.release(); } catch { /* already gone */ } lock = null; }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.playing) wake(true); });

  // ---------------------------------------------------------------- per-frame
  ui.update = () => {
    // auto-collapse the coaching sheet while a continuous loop plays; restore when paused
    const playingLoop = app.playing && app.mode === 'continuous' && !app.trainer.active;
    if (portrait()) {
      if (playingLoop && !ui.wasPlaying && ui.snap !== 'head') { ui.prevSnap = ui.snap; setSnap('head'); ui.autoCollapsed = true; }
      if (!playingLoop && ui.wasPlaying && ui.autoCollapsed) { setSnap(ui.prevSnap || 'open'); ui.autoCollapsed = false; }
    }
    ui.wasPlaying = playingLoop;
    if (app.playing !== ui.wakeWant) { ui.wakeWant = app.playing; wake(app.playing); }
    // toggles and selections in the options sheet
    document.querySelectorAll('[data-tg]').forEach((b) => b.classList.toggle('on', !!({ angles: app.showAngles, line: app.forceLine, trail: app.trailOn,
      tilt: ui.tilt })[b.dataset.tg]));
    document.querySelectorAll('[data-mcam]').forEach((b) => b.classList.toggle('on', b.dataset.mcam === app.camMode));
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === app.speedI));
    document.querySelectorAll('[data-hand]').forEach((b) => b.classList.toggle('on', b.dataset.hand === app.s.handedness));
    document.querySelectorAll('[data-lite]').forEach((b) => b.classList.toggle('on', b.dataset.lite === app.s.lite));
    $('bCam').textContent = ({ auto: 'Auto cam', third: '3rd person', first: '1st person', coach: 'Coach view' })[app.camMode];
    $('tNoclip').classList.toggle('on', app.trainer.noclip); $('tNoclip').textContent = app.trainer.noclip ? 'NOCLIP ON' : 'NOCLIP';
    $('tRun').textContent = app.touchWalk ? 'WALK' : 'RUN';
    $('tTilt').classList.toggle('on', ui.tilt);
    $('tFov').textContent = `FOV ${app.trainer.fov}`;
  };
  return ui;
}
