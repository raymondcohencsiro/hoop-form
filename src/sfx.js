// Sound effects: the swish and the bounce, played with the Web Audio API and placed in 3D around the listener
// (the camera, or your head in VR). The sounds are synthesized in sfxSynth.js; there are no audio files.
import { swishSamples, bounceSamples } from './sfxSynth.js';

export class Sfx {
  constructor(on = true) { this.on = on; this.ctx = null; this.buf = null; this.master = null; this.lastAt = {}; this.onBlocked = null; this.warned = new Set(); }
  get state() { return this.ctx ? this.ctx.state : 'not started'; }
  warn(what, e) { if (this.warned.has(what)) return; this.warned.add(what); console.warn(`[sound] ${what}`, e || ''); }
  /** Create / resume the audio context. Browsers only allow that from a tap, click or key press, so the app calls this from those. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { this.warn('this browser has no Web Audio'); return false; }
        const ctx = new AC({ latencyHint: 'interactive' });
        try {                                                                      // only keep the context once everything is built, so a failure retries on the next gesture
          const sr = ctx.sampleRate, mk = (d) => { const b = ctx.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };
          const buf = { swish: mk(swishSamples(sr)), bounce: mk(bounceSamples(sr)) };
          const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
          this.buf = buf; this.master = master; this.ctx = ctx;
        } catch (e) { try { ctx.close(); } catch { /* ignore */ } throw e; }
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch((e) => this.warn('the browser would not start audio', e));
      return true;
    } catch (e) { this.warn('could not start audio', e); return false; }
  }
  /** Where the listener is and which way it faces. Babylon is left-handed and Web Audio right-handed, so z flips. */
  listen(p, f) {
    const c = this.ctx; if (!c) return; const l = c.listener;
    if (![p.x, p.y, p.z, f.x, f.y, f.z].every(Number.isFinite)) return;
    const fl = Math.hypot(f.x, f.y, f.z); if (fl < 1e-6) return;
    const up = Math.abs(f.y) / fl > 0.999 ? [0, 0, 1] : [0, 1, 0];                 // looking straight up or down: pick another up so the two never line up
    try {
      if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = -p.z; l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = -f.z; l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2]; }
      else { l.setPosition(p.x, p.y, -p.z); l.setOrientation(f.x, f.y, -f.z, up[0], up[1], up[2]); }
    } catch (e) { this.warn('could not place the listener', e); }
  }
  play(kind, pos, gain = 1, rate = 1) {
    if (!this.on) return;
    const c = this.ctx;
    if (!c || !this.buf || c.state !== 'running') { if (c && c.state !== 'running') c.resume().catch(() => {}); if (this.onBlocked) this.onBlocked(); return; }
    const now = c.currentTime; if (now - (this.lastAt[kind] ?? -1) < 0.05) return; this.lastAt[kind] = now;   // scrubbing must not machine-gun
    try {
      const src = c.createBufferSource(), g = c.createGain(); src.buffer = this.buf[kind]; src.playbackRate.value = rate; g.gain.value = gain;
      let pan = null; src.connect(g);
      if (pos && c.createPanner) {
        pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 3; pan.rolloffFactor = 0.7; pan.maxDistance = 100;
        if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = -pos.z; } else pan.setPosition(pos.x, pos.y, -pos.z);
        g.connect(pan); pan.connect(this.master);
      } else g.connect(this.master);
      src.onended = () => { try { src.disconnect(); g.disconnect(); if (pan) pan.disconnect(); } catch { /* already gone */ } };
      src.start();
    } catch (e) { this.warn('could not play a sound', e); }
  }
  /** a short confirmation bounce, for when sound is turned on */
  tick() {
    if (!this.on || !this.unlock()) return;
    const c = this.ctx, go = () => this.play('bounce', null, 0.7);
    if (c.state === 'running') go(); else c.resume().then(go).catch(() => {});
  }
  /** play the events whose time falls in (t0, t1] */
  fire(events, t0, t1) {
    for (const e of events) if (e.t > t0 && e.t <= t1) this.play(e.kind, e.pos, e.gain, (e.kind === 'bounce' ? 0.94 : 0.97) + Math.random() * (e.kind === 'bounce' ? 0.12 : 0.06));
  }
}
