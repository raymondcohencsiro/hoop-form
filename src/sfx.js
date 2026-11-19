// Sound effects: the swish and the bounce, played with the Web Audio API and placed in 3D around the listener
// (the camera, or your head in VR). The sounds are synthesized in sfxSynth.js; there are no audio files.
import { swishSamples, bounceSamples } from './sfxSynth.js';

export class Sfx {
  constructor(on = true) { this.on = on; this.ctx = null; this.buf = null; this.master = null; this.lastAt = {}; }
  /** Create / resume the audio context. Browsers only allow that from a tap, click or key press, so the app calls this from those. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
        this.ctx = new AC(); const sr = this.ctx.sampleRate;
        const mk = (d) => { const b = this.ctx.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };
        this.buf = { swish: mk(swishSamples(sr)), bounce: mk(bounceSamples(sr)) };
        this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return true;
    } catch { return false; }
  }
  /** Where the listener is and which way it faces. Babylon is left-handed and Web Audio right-handed, so z flips. */
  listen(p, f) {
    const c = this.ctx; if (!c) return; const l = c.listener;
    try {
      if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = -p.z; l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = -f.z; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
      else { l.setPosition(p.x, p.y, -p.z); l.setOrientation(f.x, f.y, -f.z, 0, 1, 0); }
    } catch { /* no listener control here */ }
  }
  play(kind, pos, gain = 1, rate = 1) {
    const c = this.ctx; if (!this.on || !c || c.state !== 'running' || !this.buf) return;
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
    } catch { /* audio failed: stay silent */ }
  }
  /** play the events whose time falls in (t0, t1] */
  fire(events, t0, t1) {
    for (const e of events) if (e.t > t0 && e.t <= t1) this.play(e.kind, e.pos, e.gain, (e.kind === 'bounce' ? 0.94 : 0.97) + Math.random() * (e.kind === 'bounce' ? 0.12 : 0.06));
  }
}
