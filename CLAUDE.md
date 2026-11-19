# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## What this is

HoopForm Web is a browser-based 3D coaching tool for junior basketball (free throw, three-pointer, layup),
built on **Babylon.js 9.36.0** with plain ES modules. There is **no build step, no bundler, no npm dependencies and no test suite**.
`package.json` only contains `{"type":"module"}`.

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
- `src/math.js`, `geometry.js`, `config.js`: vector kit, geometry helpers, FIBA dimensions and default settings.
- `assets/skills.json`: all coaching content, phases, key poses and timing. `assets/*.jpg|png`: court and ball textures.
- `sw.js`, `manifest.json`, `icons/`: PWA and offline support.

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

There are no automated tests, so verify by running the app:
1. Serve it and open the page; check the browser console for errors.
2. Play all three skills, step through phases with the arrow keys, and try both handedness settings (`H`).
3. Check the camera modes (`1`-`4`) and a narrow phone-sized viewport in portrait and landscape.
4. Try `?lite=on`. For physics changes, confirm the free throw and three still go in and the layup run looks right.

## Docs and licenses

- Keep `README.md` in sync when controls, files or features change.
- Babylon.js is Apache-2.0; its notice lives in `THIRD_PARTY_LICENSES.md`.
- The project itself has no license yet. Do not add one without being asked.
