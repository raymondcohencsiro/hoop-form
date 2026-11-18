# HoopForm Web (Babylon.js)

Browser version of HoopForm, the junior basketball coaching tool: a 3D FIBA arena, a
coaching avatar and step-by-step biomechanics for the **free throw**, **three-pointer** and
**layup**. Runs from a link on desktop and phone browsers (WebGL2; WebGPU opt-in).

## Run locally

Any static file server works (ES modules don't load from `file://`):

```bash
cd hoopform-web
python -m http.server 8000
# open http://localhost:8000
```

Add `#webgpu` to the URL (or use *Settings → Try WebGPU*) to try the WebGPU renderer; it
falls back to WebGL2 automatically.

## Controls

| Desktop | Touch | Action |
|---|---|---|
| Space | ▶ / ⏸ | Play the whole skill on repeat / pause |
| → / ← | ⏭ / ⏮ | Play the next phase and stop / back one phase |
| K | skill menu | Free throw → three-pointer → layup |
| + / − | Speed | 0.1×–1× speed (the speed button opens a list of speeds) |
| 1–4, C | camera buttons | Auto (each phase picks a view) · Third person (orbit camera that follows the player) · First person (the player's eyes; drag looks around, wheel/pinch changes the field of view) · Coach view (walk around); C = next camera |
| drag, wheel, Q/E, [ ] | drag, pinch | Orbit, zoom, field of view |
| F, 4 | Coach view | Walk the court at the junior's eye height: WASD run, Shift walk, right-click jump, Ctrl crouch, inverted-Y mouse look (click the view to capture the mouse), N noclip (right-click/E up, Ctrl/Q down), wheel FOV, F/Esc exit. Touch: left stick, drag to look, JUMP / CROUCH / NOCLIP / FOV buttons |
| H | Right | Left- or right-handed shooter |
| A, L, T, R | Angles, Line, Trail | Protractors · shooting line · ball trail · restart |

On a phone: drag one finger on the court to turn the camera, tap to play or pause, ⏮ / ⏭ for phases, two fingers to
turn the camera and pinch to zoom. The camera button at the top cycles Auto → 3rd person → 1st person → Coach view. The playback bar is ⏮ ▶/⏸ ⏭ and a
Speed button (tap for 0.1×–1×); ⋯ also holds speed,
cameras, display toggles, handedness, settings, coach view (with look speed and tilt-to-look)
and full screen. Held upright, the coaching panel shows the title plus one section at a time - Cues, Why,
Checks, Faults, Drill: swipe it sideways or tap the tabs. Tap or drag the handle to fold it to
the title; it folds while a continuous loop plays and comes back when you pause. Sideways, coaching is an overlay
you can hide. A short tour runs on first visit.

Lite mode (Auto / On / Off): drops reflections, the upper-tier seats and shadow resolution;
on Auto it switches itself on if the frame rate stays under 30 fps. The screen stays awake
while playing, drawing stops when the page is hidden, and the page can be added to the home
screen (manifest + offline service worker, when opened directly rather than inside a frame).

Settings (⚙): player height, rim height, ball size 5/6/7, release angle, shadows, reflections, stands.
They are remembered in the browser.

## The avatar

The player is one continuous skinned body (torso, arms and legs bend smoothly at the
elbows, knees, hips and spine) wearing skinned clothing: a tank-top jersey with trimmed
armholes and numbers, loose shorts with side stripes, crew socks and high-top sneakers.
The head is sculpted (jaw, cheekbones, brow, nose, lips, eye sockets) with eyelids, irises,
ears and a short haircut. Everything is generated in code from the same skeleton the
coaching maths uses, so the motion and every checkpoint are unchanged; only the surface
that follows the skeleton is new.

## How it is built

```
index.html          page, HUD styles and layout (desktop / phone portrait / phone landscape)
src/main.js         app: game loop, HUD, input, playback, camera framing
src/render.js       Babylon.js: engine, lights + shadows, arena, reflective floor, ball, net, overlays
src/court.js        painted maple court surface + every FIBA line as vector geometry
src/stadium.js      empty two-tier arena bowl: seats (thin instances), stairs, rails, suites, LED ribbon
src/body.js         avatar surface: skinned body + clothing, sculpted head, hands, sneakers (bind pose)
src/avatarView.js   avatar rendering: Babylon skeleton driven by the joints, materials, painted textures
src/cameras.js      camera modes, coaching presets with auto-fit (used by Auto), walk-around coach view
src/phone.js        touch UI: coaching sheet, options sheet, tour, floating joystick, tilt, wake lock
src/coach.js        headless coaching core (port of the Python Coach): timeline, footwork, ball
src/avatar.js       skeleton, IK (guide hand: damped least squares), arm/torso clearance
src/gait.js         run-in gait for the layup (speed profile, flights, footprints)
src/ball.js         ball flight: launch solve, bank shots, swish, net drag, floor bounces
src/animation.js    monotone cubic keyframe timeline, left-handed mirroring
src/metrics.js      the live checkpoint metrics
src/math.js, geometry.js, config.js
assets/             skills.json, court and ball textures (exported from Python)
```

The Python app stays the authoring tool. The JS core is a straight port and was checked
numerically against it (end times and release angles match; joints agree to well under
1 mm except where the guide-hand IK picks an equally valid solution).

**Web-only changes since the port** (the Python app is no longer updated):

- *Throwing release* (`CoachCore._retimeRelease`). For the last 0.12 s before release the shooting
  arm follows a solved path instead of the authored keys: the hand runs on a smooth curve into the
  release point at a real throwing speed, and the shoulder and elbow are solved by IK to follow it.
  Joint speeds are capped at realistic peaks (elbow ~1200-1250°/s, shoulder ~700-770°/s), and a
  short fingertip roll-off adds the rest of the launch speed. The release is earlier
  (`release_fraction` 0.40 for the free throw and the three, −0.5 for the layup, i.e. late in the
  jump), so the ball leaves while the elbow is still opening (about 127° on shots and 140° on the
  layup) and the elbow finishes straight in the follow-through. The release checkpoints were
  re-ranged to match (115-150° for shots, 125-165° for the layup).
  Re-exporting `skills.json` from Python overwrites these values.
- *Dribble path* (`CoachCore._dribblePath`). Hermite pieces: down from the hand with the hand's
  velocity under gravity plus a steady push; up from the floor at the speed gravity needs to reach the
  hand, arriving with the hand's velocity. The bounce time is chosen per dribble so the ball comes up at
  ~78% of its landing speed (about 5.5 m/s down, 4.4 m/s up), during the LEFT-foot stance.
- *Layup run* (`gait.js`, `CoachCore._dribbleArm/_runArms`, `skills.json` gait spec). The dribbling
  hand rides at waist height in front of the hip, palm down, and pushes the ball forward-down, so
  the bounce is out in front and to the side, clear of the legs (`_clearDribble` models the thigh
  with the loose shorts). The swing foot kicks up behind before coming through, and the free arm
  swings against the legs. The ONE-TWO steps are longer than the running strides (about 1.2 m and
  1.05 m against 0.9 m): each has a longer flight before it, the hips sink a little on ONE, and the
  ONE leg swings through under the hips during TWO before driving up.
  Speed: quick first steps (about 1 m/s after 0.2 s, 2 m/s by 0.45 s) up to 2.75 m/s, so the strides
  open from about 0.35 and 0.8 m to 0.95 m, then 1.26 m (ONE) and 1.09 m (TWO); the start is ~9.6 m out on
  the right wing, inside the sideline.
  Hip heights are set so the legs extend like a runner's: the stance knee lands at about 165-170°,
  bends to about 140-145° mid-stance and straightens to 160-175° at push-off; the ready stance is
  about 130°; the 1-2 still sinks the hips (about 7 cm at the TWO plant) before the jump leg straightens.
- *Hoops* (`render.js buildHoop`). 20 mm ring on a flange plate with two braces and 12 net hooks; the
  net is simulated (`net.js NetSim`): 9 x 24 knots hung from the hooks, joined by the
  diamond cords and soft rings, Verlet + constraints with drag and a light pull back to the hanging
  shape; the ball pushes knots aside and drags them with friction, the bottom opening is a little
  narrower than the ball so it checks it. Stepped in skill time (slow motion slows it), reset on seeks; tempered-glass backboard with green
  edges, an aluminium frame, painted border and shooter's square, padding along the bottom and up the
  sides, and a static reflection probe of the arena (skipped in lite mode); portable stanchion with a
  padded base, padded raked post and a curved boom to a steel frame behind the glass.
- *Shot readout* (`App.updateShotReadout`, `Overlays.setShotReadout`). When a free throw or three goes
  in: a launch-angle wedge at the release point, a small tick at the top of the arc, an entry-angle wedge at the ring, labels on each, and a card with the three numbers
  and a one-line read of the arc. From the release on, light-grey arcs show the ideal path to the
  ring (45° entry) and the acceptable band (38-52° entry) from the same release point (`App.guidePaths`).
  Overlay meshes carry `metadata.noReflect` and stay out of the floor mirror.
- *Camera modes* (`App.setCamMode`): auto, third, first, coach. In Auto, from just before the release the
  camera swings round over the shooting shoulder (`OrbitCam.shotGoal`) at about the usual coaching
  distance, aimed so the release point (hand, `BallPhysics.p0`), the head and shoulders, the arc
  (`apex_y`) and the ring + backboard fit in the free part of the screen; it eases back only if they can't. Turning the Auto view hands it over to
  Third person. First person sits at the eyes and follows the head (which tracks the rim), smoothed;
  overlays (angles, shooting line, joint highlights) are hidden there.
- *Camera* (`OrbitCam.update`). After you turn or zoom the view, the camera keeps your angle and
  distance but its look-at point still follows the player, so the running layup stays centred.
- *Coaching content* (`assets/skills.json`). Every phase has `why`, `cues` (shown first; each fits on one line, even on a small phone held sideways; text before an optional " — " is bold), `faults` written as `"problem → fix"` (the panel
  shows the fix on its own line) and a `drill`: one short practice drill (`"Name: how to do it"`).
  Left-handed players get the same text with left/right swapped (`mirrorText`).

After changing a skill, the court or the ball textures in Python, re-export:

```bash
python tools/export_web.py ../hoopform-web/assets
```

Babylon.js 9.36.0 loads from jsDelivr; nothing needs building.
