// Shared helpers for the test suite. Everything here runs in plain Node: the coaching
// maths is headless (no Babylon.js, DOM or window), so no browser or build step is needed.
import fs from 'node:fs';
import { CoachCore } from '../src/coach.js';
import { defaultSettings } from '../src/config.js';

export const SKILLS = JSON.parse(fs.readFileSync(new URL('../assets/skills.json', import.meta.url), 'utf8'));
export const SKILL_KEYS = SKILLS.skills.map((s) => s.key);
export const HANDS = ['right', 'left'];

/** Build a fresh CoachCore. The skills data is cloned so tests cannot affect each other. */
export function makeCore(skill, overrides = {}) {
  return new CoachCore({ ...defaultSettings(), skill, ...overrides }, structuredClone(SKILLS));
}

// Building a CoachCore solves the release, footwork and ball flight, which takes 0.1-0.25 s.
// Tests that only read the result, or that seek before reading, can share one. Each test file
// runs in its own process, so this cache is per file. Use makeCore() when a test needs a pristine core.
const shared = new Map();
export function sharedCore(skill, overrides = {}) {
  const id = JSON.stringify([skill, overrides]);
  if (!shared.has(id)) shared.set(id, makeCore(skill, overrides));
  return shared.get(id);
}

/** Call fn(t) for t = 0, step, 2*step ... up to and including end. */
export function sweep(end, step, fn) {
  for (let t = 0; t <= end + 1e-9; t += step) fn(t);
}

/** Distance between two V3 values. */
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
