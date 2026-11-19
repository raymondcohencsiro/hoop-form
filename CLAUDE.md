# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## What this is

HoopForm Web is a browser-based 3D coaching tool for junior basketball (free throw, three-pointer, layup),
built on **Babylon.js 9.36.0** with plain ES modules. There is **no build step, no bundler and no npm dependencies**.
Tests use Node's built-in runner (`npm test`); `package.json` only declares `"type": "module"`, the Node version and that script.

## Run it

```bash
python -m http.server 8000     # then open http://localhost:8000
```

`run.bat` does the same on port 8010 (Windows). ES modules will not load from `file://`.
Useful URL switches: `#webgpu` (WebGPU renderer), `?lite=on|off` (force lite mode).
`window.hoopform` is the running `App`, handy from the browser console.

## Layout

- `index.html`: markup, all CSS, and the Babylon.js `<script>` tag (loaded from jsDelivr as the global `window.BABYLON`).
- `src/main.js`: `App` class: game loop, HUD, input, playback, settings persistence.
- `src/render.js`, `src/avatarView.js`, `src/stadium.js`, `src/court.js`, `src/body.js`, `src/net.js`: Babylon.js scene and meshes.
- `src/coach.js` (`CoachCore`), `avatar.js`, `ball.js`, `gait.js`, `metrics.js`, `animation.js`: **headless** coaching maths.
- `src/cameras.js`, `src/phone.js`: cameras and touch UI.
- `src/sfx.js` (Web Audio player) and `src/sfxSynth.js` (**headless** synthesized swish and bounce); `CoachCore.soundEvents()` gives the ball's
  sound times. Tested in `tests/sfx.test.js`.
- `src/vr.js`, `src/vrPanel.js`, `src/vrPointer.js`: VR mode (WebXR through Babylon's `createDefaultXRExperienceAsync`). `src/vrmath.js` is the **headless**
  half (spots, walk clamp, panel layout and hit-testing, stick edges) and is tested in `tests/vr.test.js`.
- `src/math.js`, `geometry.js`, `config.js`: vector kit, geometry helpers, FIBA dimensions and default settings.
- `assets/skills.json`: all coaching content, phases, key poses and timing. `assets/*.jpg|png`: court and ball textures.
- `sw.js`, `manifest.json`, `icons/`: PWA and offline support.
- `tests/`: automated tests for the headless code (`*.test.js`, plus `helpers.js`). `.github/workflows/test.yml` runs them in CI.

## Conventions to respect

- **Keep the maths headless.** Files that do coaching maths (`coach.js`, `avatar.js`, `ball.js`, `gait.js`, `metrics.js`,
  `animation.js`, `math.js`) must not touch Babylon.js, the DOM or `window`. Rendering reads from `CoachCore`, never the reverse.
- **Units and axes**: metres and degrees. Left-handed coordinates like Babylon.js: +X to the shooter's right, +Y up,
  +Z toward the basket. Matrices are row-vector style (`v' = v * M`, translation in `m[12..14]`); see the header of `src/math.js`.
- **Left-handed shooters** are handled by mirroring poses (`mirrorPose`) and text (`mirrorText`). Joint names end in `_R` / `_L`.
  When adding a pose or text, make sure the mirror still works.
- **Style**: ES modules, `const`/`let`, 2-space indent, single quotes, semicolons, compact one-line helpers are common.
  Match the surrounding file rather than reformatting it. Files use CRLF line endings; preserve them.
- **Persistence**: settings are stored in `localStorage` under keys prefixed `hoopform.`; keys starting with `_` are
  runtime-only and are stripped on save. Always wrap storage access in try/catch (private mode).
- **Performance**: phones are a first-class target. Respect the `mobile` / `lite` flags when adding meshes, shadows,
  reflections or per-frame allocations. Seats use thin instances; keep it that way.
- **Overlay meshes** that should not appear in the floor mirror carry `metadata.noReflect`.
- **VR**: no `babylonjs-gui`; the panel and labels are canvas textures. Only the floor and the panel are pickable while the XR helper exists. Never move
  the VR camera smoothly (comfort); use fade-teleports. In VR `frame()` skips `placeCamera` and the DOM HUD, so anything new that projects to DOM labels needs a 3D label path (`vr.label`).
- **No new runtime dependencies** without asking. If one is added, update `THIRD_PARTY_LICENSES.md` and the README.

## Coaching content (`assets/skills.json`)

Skills are `shooting`, `three` and `layup`. Each phase has `why`, `cues`, `faults`, `checks`, `drill` and more.
- `cues`: each must fit on one line on a small phone held sideways; text before an optional ` — ` is bold.
- `faults`: `"problem → fix"`.
- `drill`: `"Name: how to do it"`.
- Checkpoint ranges in `checks` must agree with what the animation actually produces; check them in the app after editing.

`skills.json` was originally exported from a Python tool (`tools/export_web.py`) that is **not in this repository** and is no
longer updated. Edit the JSON directly; never assume a re-export will happen.

## Verifying changes

**Run the tests first**: `npm test` (or `node --test`). They need Node 20+ and no install, and take roughly 10-30 s.
They cover everything headless (see the table in the README's *Testing* section). They do **not** cover rendering, the HUD,
cameras or touch input, so for those also check by eye:
1. Serve the app and open the page; check the browser console for errors.
2. Play all three skills, step through phases with the arrow keys, and try both handedness settings (`H`).
3. Check the camera modes (`1`-`4`) and a narrow phone-sized viewport in portrait and landscape.
4. Try `?lite=on`.
5. VR (not covered by tests): serve over `localhost`, use the Immersive Web Emulator extension or a headset, press **Switch to VR**, and check
   teleport (left stick), the panel (Y, trigger), A / B / X, snap turn, the Spots tab and the 3D angle labels. While in VR the scene must not be
   rebuilt (`buildWorld` refuses), because the XR helper belongs to one scene.

### Working with the tests

- Add tests next to the code they cover, as `tests/<area>.test.js`, using `node:test` and `node:assert/strict`.
- Use `sharedCore(skill, overrides)` from `tests/helpers.js` for read-only access to a `CoachCore`. Building one takes
  0.1-0.25 s, and the cache is per test file. Use `makeCore()` for a pristine core. Always `seek()` before reading a shared core.
- Keep the suite fast. Prefer one pass over a playback that several tests then assert on, and a small parameter grid
  (the extremes) over a dense one.
- **A failing checkpoint test is usually a content/tuning mismatch, not a code bug.** If you retime or re-pose a phase,
  the `lo`/`hi` ranges in `assets/skills.json` may need to move with it, or the other way round. Checkpoints are only
  guaranteed in range at the *end* of a phase, so tests sample there.
- Tests assert documented behaviour (README numbers such as the release elbow angle and run-in speeds). If you deliberately
  change that behaviour, update the README and the test together.
- `tests/mirroring.test.js` has `todo` tests for a known guide-arm IK asymmetry. Leave them as `todo` until it is fixed, then promote them.
- Do not add a test framework or dependencies; the built-in runner is enough.

## Docs and licenses

- Keep `README.md` in sync when controls, files, features or tests change.
- Babylon.js is Apache-2.0; its notice lives in `THIRD_PARTY_LICENSES.md`.
- The project itself has no license yet. Do not add one without being asked.
