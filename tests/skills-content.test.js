// Validates assets/skills.json: the coaching content and the data the engine relies on.
// These catch typos and incomplete edits that would otherwise only show up as a broken
// panel or a missing checkpoint in the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, SKILL_KEYS, makeCore } from './helpers.js';
import { METRICS } from '../src/metrics.js';
import { PRESETS } from '../src/cameras.js';

const MAX_CUE_CHARS = 60;     // cues must fit on one line, even on a small phone held sideways
const MAX_DRILL_NAME = 40;    // the UI only bolds the drill name when "Name: " is shorter than this

test('skills.json lists the three skills in a consistent order', () => {
  assert.deepEqual(SKILLS.order, ['shooting', 'three', 'layup']);
  assert.deepEqual([...SKILL_KEYS].sort(), [...SKILLS.order].sort());
});

for (const skill of SKILLS.skills) {
  test(`${skill.key}: skill-level fields`, () => {
    for (const f of ['name', 'summary', 'mnemonic', 'short_name']) assert.ok(skill[f] && typeof skill[f] === 'string', `${f} is a non-empty string`);
    assert.ok(Array.isArray(skill.spot) && skill.spot.length === 2 && skill.spot.every(Number.isFinite), 'spot is [x, z]');
    assert.ok(Number.isFinite(skill.heading));
    assert.ok(skill.release_angle > 30 && skill.release_angle < 80, 'release angle is a plausible launch angle');
    const keys = skill.phases.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length, 'phase keys are unique');
    assert.ok(keys.includes(skill.release_phase), 'release_phase names an existing phase');
    if (skill.align_phase) assert.ok(keys.includes(skill.align_phase), 'align_phase names an existing phase');
    assert.ok(skill.release_fraction >= -1 && skill.release_fraction <= 1, 'release_fraction is a sensible fraction of the phase');
  });

  for (const phase of skill.phases) {
    test(`${skill.key}/${phase.key}: coaching text is complete and well formed`, () => {
      assert.ok(phase.title, 'has a title');
      assert.ok(phase.duration > 0, 'has a positive duration');
      assert.ok(phase.why && phase.why.length > 20, 'has a "why"');
      assert.ok(phase.cues.length >= 1, 'has at least one cue');
      for (const cue of phase.cues) {
        assert.ok(cue.trim().length > 0, 'cue is not empty');
        assert.ok(cue.length <= MAX_CUE_CHARS, `cue is ${cue.length} chars, limit ${MAX_CUE_CHARS}: "${cue}"`);
      }
      assert.ok(phase.faults.length >= 1, 'has at least one fault');
      for (const f of phase.faults) {
        const [problem, fix, ...rest] = f.split(' → ');
        assert.ok(problem.trim() && fix && fix.trim() && rest.length === 0, `fault must read "problem → fix": "${f}"`);
      }
      const di = phase.drill.indexOf(': ');
      assert.ok(di > 0 && di < MAX_DRILL_NAME, `drill must read "Name: how to do it" with a short name: "${phase.drill.slice(0, 50)}"`);
      assert.ok(phase.drill.length - di > 20, 'drill explains how to do it');
    });

    test(`${skill.key}/${phase.key}: checkpoints use real metrics with sane ranges`, () => {
      for (const ch of phase.checks) {
        assert.ok(ch.label && ch.unit !== undefined, 'has a label and unit');
        assert.ok(ch.metric in METRICS, `unknown metric "${ch.metric}"`);
        assert.ok(Number.isFinite(ch.lo) && Number.isFinite(ch.hi), 'has lo and hi');
        assert.ok(ch.lo <= ch.hi, `${ch.label}: lo ${ch.lo} must not exceed hi ${ch.hi}`);
      }
      assert.ok(phase.camera in PRESETS, `unknown camera preset "${phase.camera}"`);
    });
  }

  test(`${skill.key}: every pose channel is defined in the rest pose (catches typos like "elbow_r")`, () => {
    // Skills with a procedural gait (the layup) drive the legs from the gait system, so their
    // leg channels intentionally have no rest-pose entry. Everything else must be declared.
    const gaitLegs = (ch) => skill.gait && /^(hip|knee|toes)_[RL]$/.test(ch);
    const known = new Set(Object.keys(skill.rest_pose));
    for (const phase of skill.phases) {
      for (const ch of Object.keys(phase.pose)) {
        assert.ok(known.has(ch) || gaitLegs(ch), `${phase.key}: channel "${ch}" is not in rest_pose`);
      }
    }
  });

  test(`${skill.key}: highlighted joints exist on the avatar`, () => {
    const core = makeCore(skill.key);
    for (const phase of skill.phases) {
      for (const joint of phase.focus) assert.doesNotThrow(() => core.avatar.world(joint), `${phase.key}: unknown joint "${joint}"`);
    }
  });
}
