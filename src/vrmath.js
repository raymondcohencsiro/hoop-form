// Headless VR maths: where to stand (viewpoints and court spots), keeping people on the court,
// where the floating panel sits, its button layout and hit-testing, and thumbstick edge detection.
// No Babylon.js, DOM or window in here (see CLAUDE.md); src/vr.js and src/vrPanel.js use it.
// Units: metres and degrees. Yaw 0 looks down +Z, positive yaw turns toward +X (like cameras.js).
import * as C from './config.js';
import { V3, DEG } from './math.js';
import { PRESETS, STANCHIONS } from './cameras.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const WALK_X = 11, WALK_Z = 18, KEEP_OUT = 1.0;      // same walkable box as the walk-around camera

/** Keep a standing point on the walkable floor and out of the player and the basket stanchions. */
export function constrainWalk(x, z, player = null, obstacles = STANCHIONS, playerR = KEEP_OUT) {
  x = clamp(x, -WALK_X, WALK_X); z = clamp(z, -WALK_Z, WALK_Z);
  const list = [...obstacles];
  if (player && playerR > 0) list.push([player, playerR]);
  for (const [c, r] of list) {
    let ox = x - c.x, oz = z - c.z; const d = Math.hypot(ox, oz);
    if (d < r) { if (d > 1e-6) { ox /= d; oz /= d; } else { ox = 1; oz = 0; } x = c.x + ox * r; z = c.z + oz * r; }
  }
  return { x: clamp(x, -WALK_X, WALK_X), z: clamp(z, -WALK_Z, WALK_Z) };
}

export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z) / DEG;

// ---------------------------------------------------------------- spots
export const VIEW_SPOTS = ['coach', 'side', 'front', 'behind', 'hands', 'shoulder', 'wide'];
export const COURT_SPOTS = ['ft', 'three_top', 'three_wing', 'three_corner', 'under', 'courtside'];
export const SPOT_LABELS = {
  coach: 'Coach', side: 'Side', front: 'Front', behind: 'Behind', hands: 'Hands', shoulder: 'Over shoulder', wide: 'Wide',
  ft: 'Free-throw line', three_top: '3pt top', three_wing: '3pt wing', three_corner: '3pt corner', under: 'Under basket', courtside: 'Courtside',
};

/**
 * Raw (unconstrained) standing point for a spot.
 * ctx: { focus: V3 (the player), rim: V3, heading: deg, lefty: bool, scale: player_height / 1.6 }
 * Returns { x, z, yaw, face } where yaw is the way to look (deg).
 */
export function rawSpot(id, { focus, rim, heading = 0, lefty = false, scale = 1 }) {
  const sign = rim.z >= 0 ? 1 : -1, flat = (p) => new V3(p.x, 0, p.z);
  const fromRim = (x, z) => ({ x, z, yaw: yawTo({ x, z }, rim) });
  if (PRESETS[id] && id !== 'shot') {
    const [py, , d0, , frac] = PRESETS[id];
    let yaw = py;
    if (lefty && yaw !== 0 && yaw !== 180) yaw = -yaw;
    if (id !== 'wide') yaw += heading;
    const dist = d0 * (0.85 + 0.15 * scale), t0 = flat(focus).add(flat(rim).sub(flat(focus)).mul(frac));
    let z = t0.z - Math.cos(yaw * DEG) * dist;
    if (Math.abs(z) > 13.4) { yaw = 180 - yaw; z = t0.z - Math.cos(yaw * DEG) * dist; }   // stay in front of the backboards
    const x = t0.x - Math.sin(yaw * DEG) * dist;
    return { x, z, yaw: yawTo({ x, z }, focus) };
  }
  switch (id) {
    case 'shoulder': {
      const to = flat(rim).sub(flat(focus)), u = to.len() > 1e-3 ? to.norm() : new V3(Math.sin(heading * DEG), 0, Math.cos(heading * DEG));
      const side = new V3(u.z, 0, -u.x).mul(lefty ? -1 : 1);                       // toward the shooting hand
      const p = flat(focus).sub(u.mul(1.1)).add(side.mul(0.45));
      return { x: p.x, z: p.z, yaw: Math.atan2(u.x, u.z) / DEG };
    }
    case 'ft': return fromRim((lefty ? -1.3 : 1.3), sign * C.ftLineZ());              // beside the shooter, level with the line
    case 'three_top': return fromRim(0, rim.z - sign * 6.75);
    case 'three_wing': return fromRim(6.75 * Math.SQRT1_2, rim.z - sign * 6.75 * Math.SQRT1_2);
    case 'three_corner': return fromRim(6.6, rim.z);
    case 'under': return fromRim(0, rim.z - sign * 0.9);
    case 'courtside': { const x = -(C.COURT_WIDTH / 2 + 1.5), z = clamp(focus.z, -13, 13); return { x, z, yaw: yawTo({ x, z }, focus) }; }
    default: throw new Error(`unknown spot ${id}`);
  }
}

/** A spot as a legal standing point: on the floor, clear of the player and the stanchions. */
export function viewSpot(id, ctx) {
  const r = rawSpot(id, ctx), p = constrainWalk(r.x, r.z, ctx.focus);
  const moved = Math.hypot(p.x - r.x, p.z - r.z) > 1e-6;
  return { id, label: SPOT_LABELS[id], x: p.x, z: p.z, yaw: moved ? yawTo(p, id === 'courtside' || PRESETS[id] ? ctx.focus : ctx.rim) : r.yaw };
}
export const allSpots = (ctx) => [...VIEW_SPOTS, ...COURT_SPOTS].map((id) => viewSpot(id, ctx));

// ---------------------------------------------------------------- floating panel
export const PANEL_W = 1024, PANEL_H = 720;          // canvas pixels (the panel is 1.2 m x 0.84 m in the world)
export const PANEL_M = { w: 1.2, h: 1.2 * PANEL_H / PANEL_W };
export const TABS = [['cues', 'Cues'], ['why', 'Why'], ['checks', 'Checks'], ['faults', 'Faults'], ['drill', 'Drill'], ['spots', 'Spots'], ['more', 'More']];
export const CONTENT = { x: 40, y: 156, w: 944, h: 384 };
/** The panel when it rides on the left controller. Controller space: +X right, +Y up out of the thumbstick face, +Z forward.
 *  It floats above the controller with its top edge pointing away from you, tilted back so it faces your eyes. Tune here. */
export const HELD_PANEL = { w: 0.5, tiltDeg: 40, offset: { x: 0, y: 0.16, z: 0.04 } };
/** the panel's own right / up / front (the side you read it from) axes, in controller space */
export function heldPanelAxes(tiltDeg = HELD_PANEL.tiltDeg) {
  const t = tiltDeg * DEG, s = Math.sin(t), c = Math.cos(t);
  return { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: s, z: c }, front: { x: 0, y: c, z: -s } };
}

/** Where the panel floats: in front of the head, a little below eye level, facing back at the person. */
export function panelPose(head, yawDeg, dist = 1.3, drop = 0.22) {
  const y = yawDeg * DEG;
  return { x: head.x + Math.sin(y) * dist, y: Math.max(0.9, head.y - drop), z: head.z + Math.cos(y) * dist, yaw: y };
}

/**
 * Every button on the panel for the tab on show, in canvas pixels. ids: tab:<k> hide prev play next
 * speed:- speed:+ hand timeline | spot:<id> follow | skill:<k> tg:<angles|line|trail> height:-|+ ball:<5|6|7> exit
 */
export function panelLayout(tab, skillKeys = []) {
  const R = [], add = (id, x, y, w, h, label = '') => R.push({ id, x, y, w, h, label });
  add('hide', 944, 14, 60, 56);
  const tw = (PANEL_W - 80) / TABS.length;
  TABS.forEach(([k, l], i) => add(`tab:${k}`, 40 + i * tw, 92, tw - 6, 52, l));
  add('timeline', 40, 556, 944, 44);
  add('prev', 40, 616, 110, 88); add('play', 160, 616, 150, 88); add('next', 320, 616, 110, 88);
  add('speed:-', 470, 630, 70, 60, '-'); add('speed:+', 656, 630, 70, 60, '+'); add('hand', 760, 630, 224, 60);
  const grid = (ids, x0, y0, cols, w, h, gap, make) => ids.forEach((id, i) => make(id, x0 + (i % cols) * (w + gap), y0 + Math.floor(i / cols) * (h + gap), w, h));
  if (tab === 'spots') {
    const w = (CONTENT.w - 36) / 4;
    grid(VIEW_SPOTS, CONTENT.x, 190, 4, w, 54, 12, (id, x, y, ww, hh) => add(`spot:${id}`, x, y, ww, hh, SPOT_LABELS[id]));
    grid(COURT_SPOTS, CONTENT.x, 326, 4, w, 54, 12, (id, x, y, ww, hh) => add(`spot:${id}`, x, y, ww, hh, SPOT_LABELS[id]));
    add('follow', CONTENT.x, 478, CONTENT.w, 56, 'Follow the player');
  } else if (tab === 'more') {
    const n = Math.max(1, skillKeys.length), sw = (CONTENT.w - 12 * (n - 1)) / n;
    skillKeys.forEach((k, i) => add(`skill:${k}`, CONTENT.x + i * (sw + 12), 190, sw, 54, k));
    ['angles', 'line', 'trail'].forEach((k, i) => add(`tg:${k}`, CONTENT.x + i * ((CONTENT.w - 24) / 3 + 12), 262, (CONTENT.w - 24) / 3, 54, k));
    add('height:-', CONTENT.x + 520, 334, 70, 54, '-'); add('height:+', CONTENT.x + 760, 334, 70, 54, '+');
    [5, 6, 7].forEach((n2, i) => add(`ball:${n2}`, CONTENT.x + 520 + i * 142, 406, 130, 54, String(n2)));
    add('exit', CONTENT.x, 474, CONTENT.w, 58, 'Exit VR');
  }
  return R;
}
/** Which button is under canvas pixel (px, py)? Later rectangles win. Returns { id, rect, u, v } (u, v inside the rect, 0..1) or null. */
export function hitTest(rects, px, py) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return { id: r.id, rect: r, u: (px - r.x) / r.w, v: (py - r.y) / r.h };
  }
  return null;
}

// ---------------------------------------------------------------- thumbstick
/** Edge detector with hysteresis: one -1 / +1 per push past `hi`; it re-arms once the stick is back under `lo`. */
export function stickEdge(state, v, hi = 0.7, lo = 0.35) {
  if (state.dir) { if (Math.abs(v) < lo) state.dir = 0; return 0; }
  if (Math.abs(v) >= hi) { state.dir = Math.sign(v); return state.dir; }
  return 0;
}
