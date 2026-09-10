# Art & audio assets

The game **runs today without any files in this folder** — every sprite has a
hand-drawn vector fallback (see `drawCarShape`, `drawPedestrianShape`,
`drawTrafficLightShape`, `drawSignShape` in `script.js`). Drop in real files
matching the names/sizes below and the game will use them automatically —
nothing else needs to change.

`manifest.json` is the source of truth for filenames, sizes and anchor
points. `AssetManager` in `script.js` reads it, tries to load every file, and
silently keeps the fallback shape for anything missing or that fails to load.

## Style brief (give this to your image-gen AI once, so everything matches)

> Top-down, friendly flat-cartoon style, high contrast for readability on
> small mobile screens. Australian road colours (dark asphalt, yellow centre
> line). Transparent background on every sprite.

## Exact files needed

| File | Size (px) | Anchor (x,y) | Notes |
|---|---|---|---|
| `car_player.png` | 128×256 | 64,200 | facing up (top of image = forward) |
| `car_red.png` / `car_blue.png` / `car_white.png` | 128×256 | 64,200 | NPC cars, same orientation |
| `ped_walk.png` | 384×64 (6 frames of 64×64) | 32,56 | walking spritesheet, 6 frames horizontal |
| `traffic_light_sprites.png` | 4 frames of 64×160 | 32,80 | off / red / amber / green |
| `sign_school40.svg` | 128×128 | 64,64 | "SCHOOL 40" |
| `sign_speed50.svg` | 128×128 | 64,64 | "SPEED 50" |
| `sign_giveway.svg` | 128×128 | 64,64 | "GIVE WAY" |
| `sign_roundabout.svg` | 128×128 | 64,64 | roundabout symbol |
| `steering_wheel.png` | 512×512 | 256,256 (center pivot) | for the on-screen touch control |
| `house_01.png` / `house_02.png` | 200×200 | — | roadside houses (bottom edge = ground line) |
| `shop_01.png` | 220×200 | — | small shopfront |
| `building_01.png` / `building_02.png` | 256×320 | — | taller apartment/office blocks |
| `sfx/horn.ogg` | ~0.4s | — | OGG preferred, MP3 fallback ok |
| `sfx/brake.ogg` | ~0.6s | — | skid sound |
| `sfx/collision.ogg` | ~0.8s | — | thud |
| `sfx/ped_alert.ogg` | ~0.5s | — | pedestrian-crossing beep |
| `sfx/light_tick.ogg` | short | — | plays whenever a light changes state |
| `music/bg_loop.ogg` | 30–90s, loopable | — | optional background music |

## Prompts to paste into an image-generation AI

**Sprites (Stable Diffusion / DALL·E / Midjourney style tools):**

> Create a set of top-down game sprites in a friendly flat-cartoon style for
> an educational road-safety game. Output transparent PNGs: player car
> 128x256 (facing up), three NPC car colours at 128x256, a 6-frame pedestrian
> walk cycle at 64x64 per frame, four traffic-light states at 64x160, and a
> steering wheel at 512x512 with a center pivot, plus roadside scenery: two
> houses at 200x200, a small shopfront at 220x200, and two taller
> apartment/office blocks at 256x320. Keep one consistent palette: dark
> asphalt, yellow centre line, Australian-style signage. Name files exactly
> as listed in this project's assets/manifest.json.

**Signs (vector tool):**

> Create simple, high-contrast SVG road signs reading "SCHOOL 40", "SPEED
> 50", "GIVE WAY", and a roundabout symbol, sized for a 128x128 display, in a
> flat cartoon style matching a top-down driving game.

**Audio (an SFX generator or library):**

> Produce short, web-ready sound effects for an arcade driving game: a brake
> skid (~0.5s), a collision thud (~0.8s), a car horn (~0.4s), and a
> pedestrian-crossing alert beep (~0.3s). Export as OGG (with MP3 fallback).

## Dropping files in

1. Add the files to this `assets/` folder using the exact names above (or
   update `manifest.json` if you rename anything).
2. Commit and push — GitHub Pages serves them as static files, no build step.
3. Reload the game. Any sprite/sound you've supplied replaces its fallback
   automatically; anything you haven't supplied yet keeps working as a shape.
