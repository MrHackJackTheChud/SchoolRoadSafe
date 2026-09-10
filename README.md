# Road Ready 🚗

A top-down, endless road-safety driving game for the browser. The road winds
left and right, with real intersections (crosswalks, stop lines, traffic
lights) and a roadside streetscape of houses, shops, apartments, parks and
trees generated as you go. Steer with arrow keys/WASD or an on-screen wheel,
obey traffic lights, give way to pedestrians, and watch your speed through
school and speed zones.

The whole world (road, buildings, signs, lights) is positioned every frame
from a single "distance travelled" value, so scenery always scrolls at
exactly the rate implied by your actual speed — no separate motion sources
to drift out of sync with each other.

**Plays right now with zero image/audio assets** — every sprite has a clean
vector fallback, so you can deploy and playtest immediately, then swap in
real art and sound later without touching the game logic. See
[`assets/README.md`](assets/README.md) for the art spec and ready-to-paste
prompts for an image/audio-generation AI.

## Run it locally

No build step. Either:

- Open `index.html` directly in a browser, or
- Serve it (needed for `fetch('assets/manifest.json')` to work over `http://`
  in some browsers): `npx serve .` then visit the printed local URL.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages** → Source: deploy from the branch you pushed
   (typically `main`) and the `/ (root)` folder.
3. Your game will be live at `https://<username>.github.io/<repo>/` within a
   minute or two.

## Project structure

```
index.html                     game markup + screens (start, how-to-play, game, pause, game over)
style.css                      visual identity (see header comment for the palette/type tokens)
script.js                      the entire game engine (asset loading, input, entities, loop, rendering)
assets/manifest.json           filenames, sizes and anchor points for every sprite/sound
assets/README.md               art spec + prompts to hand to an image/audio-generation AI
assets/sfx/, assets/music/     drop real audio files here (empty for now)
.github/copilot-instructions.md   conventions for GitHub Copilot when you keep building with it
```

## Controls

- **Steer:** ← → or A/D, or drag the on-screen wheel
- **Accelerate / brake:** ↑/↓ or W/S, or the on-screen pedals
- **Pause:** Space, or the pause button

## Adding real art/audio

Drop files into `assets/` using the exact names in `assets/manifest.json`
(full spec in `assets/README.md`) and push — no code changes needed. Any
sprite you haven't supplied yet keeps rendering as a fallback shape.
