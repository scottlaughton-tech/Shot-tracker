# Last Light – the hunting game (developer guide)

A web-based deer hunting game inside Shot Tracker, opened by tapping the 🦌 in the map's top-left
corner (route `/game`, behind the same party passcode). Landscape, touch controls, one hand aims
and the other fires. The terrain, trees, grass, the buck and all sounds are generated in code at
load time: there are no 3D model or audio files. The only image files are CC0 photo textures
(ground, bark, rock) and a pre-drawn copy of the code-drawn foliage atlas, in `public/game/tex/`.

## How it plays

- The player sits in a ladder stand (eye 4.2 m above the ground) on the south edge of an old
  field near Bancroft. The field runs ~1 km north, rising gently away from the stand.
- **Touch and hold** anywhere (not on a button) → scope opens aimed where you touched. **Slide** to
  aim (relative, like a trackpad; sensitivity scales with magnification). **Lift** to lower the rifle.
- **FIRE** (right thumb), **+ / −** magnification 4–16×. Desktop: hold the mouse, Space/F fires, +/− zoom.
- 10 rounds per hunt: 5 in the rifle, then a 3.2 s reload. 1.25 s bolt cycle between shots.
- **Last light:** a hunt lasts about 5½ minutes of game time (`Game.HUNT_LENGTH`). The sun sinks and
  the light warms and dims; at the end it's too dark to shoot.
- Up to 12 bucks come out, a new one every ~25 s, at most three in view. The hunt ends when the rifle
  is empty and every hit buck is accounted for, or at last light.
- No range help: the reticle has a deer ranging scale. Misses say how far off the shot was and how
  far away the buck really was ("40 cm low – he was 310 m away").
- Wounded bucks run for cover. If they reach it: −75 points.
- **Re-grip:** lift the aiming finger and touch again within 350 ms and the scope stays up where it
  was (lets you keep tracking a moving buck).
- Sounds are stereo-panned by direction: grunts from cruising bucks, a stick snapping when one steps
  out of the bush, alarm snorts, hit "whops". The pause button (and leaving the app) pauses the hunt.
- The results screen shows each buck hit with a side-view diagram of the vitals and the bullet holes.

## Files

```
app/game/page.tsx          auth check → <GameShell/> (landscape viewport, no zoom)
app/game/debug/page.tsx    developer previews: /game/debug?show=atlas|bark|trees|deer|deer:row|deer:walk|deer:trot|deer:run|deer:dead|deer:front|deer:quarter
app/api/game/scores/       GET top 20 · POST a finished hunt (shared leaderboard)
lib/store.ts               topScores/addScore: Redis sorted set "shot-tracker:game-scores" (kept apart
                           from the map's single hash so the map refresh stays one read)
game/
  ballistics.ts            .308 Win 150 gr, G1 drag, 200 m zero: trajectory stepper + drop table (tested)
  scoring.ts               hit zones → outcome + points, kill score breakdown (tested)
  ui/GameShell.tsx         client-only loader (no SSR for three.js)
  ui/GameRoot.tsx          screens (menu, play HUD, results, leaderboard, how-to), touch handling
  ui/DebugView.tsx         /game/debug previews
  ui/DeerDiagram.tsx       results-screen side view of the vitals with the bullet holes
  engine/Game.ts           renderer, cameras, aiming, rifle state, bullets, vegetation LOD refresh,
                           shadows, adaptive resolution, debug helpers
  engine/Hunt.ts           spawns bucks, scoring, banners, end of hunt, summary
  engine/reticle.ts        scope overlay + first-focal-plane reticle (BDC from ballistics.ts)
  engine/effects.ts        dust/hair puffs
  engine/audio.ts          synthesised sounds (WebAudio)
  engine/preview.ts        model previews for the debug page
  world/layout.ts          THE MAP: field outline, islands, hedgerow, swale, height function, and a
                           4 m ground cache (buildGroundCache / sampleGroundFast) everything else reads
  world/terrain.ts         polar-grid ground mesh centred on the stand + exact heightAt()
  world/groundMaterial.ts  ground shading from per-vertex masks
  world/sky.ts             Preetham sky, cloud dome, sun/hemisphere light, fog, sunset (setLight),
                           sky environment lighting (PMREM, rebuilt as the sun moves)
  world/foliageTextures.ts canvas-drawn foliage atlas (4×4 cards) with coverage-preserving mipmaps; bark.
                           At runtime the pre-drawn public/game/tex/atlas.webp is loaded instead of
                           drawing (drawing takes ~3 s); regenerate it with `npm run bake-atlas`
  world/photoTextures.ts   loads the CC0 photo textures (falls back to drawn ones if they fail)
  world/rocks.ts           granite boulders (triplanar photo texture + lichen), near/far detail
  world/fence.ts           zig-zag split-rail cedar fence along the hedgerow
  world/treeGen.ts         procedural trees/shrubs (bark tubes + foliage cards), grass clumps
  world/forest.ts          placement of ~52k trees, impostor baking, full-model vs impostor LOD
  world/grass.ts           view-dependent grass/goldenrod/fern clumps on a world-anchored grid
  world/vegMaterials.ts    foliage (wind sway), bark, impostor (billboard + baked normals) materials
  world/noise.ts, textures.ts  seeded RNG, simplex noise, tiling noise texture
  deer/anatomy.ts          skeleton joints, body shapes (SDF), organs — all in metres, bind pose
  deer/sdf.ts              SDF primitives + surface-nets mesher (pure)
  deer/model.ts            builds the skinned buck mesh, coat colours, ears, eyes, fur material
  deer/antlers.ts          rack generator (spike … 12-pt) + hit capsules
  deer/anim.ts             procedural gaits with leg IK, head/tail/ear poses, kick, death
  deer/routes.ts           cover points along edges, routes across the field, escape to cover
  deer/Deer.ts             one buck: behaviour state machine, reactions, bullet hit test
scripts/bake-atlas.cjs     saves the drawn foliage atlas to public/game/tex/atlas.webp (needs a running
                           dev server, Playwright and Python Pillow)
public/game/tex/           photo textures (see CREDITS.txt) and atlas.webp
```

## Key ideas (why it's built this way)

- **The camera never moves.** Only the view direction and magnification change. So:
  - the ground is a polar grid around the stand (fine near, coarse far, no LOD seams);
  - trees far away are camera-facing impostors baked from the real models (albedo + normals,
    lit at runtime); a tree gets its full model when `distance ÷ magnification < 75 m` and it's
    within 16 m of the edge of the cover (deeper ones are hidden anyway);
  - grass is generated only for the ground currently in view, on a grid whose cell size grows
    with `distance ÷ magnification`, so the scope at 16× shows dense grass around a buck 400 m away.
  - Vegetation is rebuilt only when the view has moved ~18% of its width (`Game.refreshVegetation`).
- **Scope:** true field of view = 19.2° ÷ power (a 4–16× hunting scope). Rendered with scissor into
  the circle's square; the reticle is drawn on a 2D canvas on top, in milliradians, so it's right at
  every magnification (first focal plane).
- **Ballistics are real.** The bullet is stepped every millisecond in 3D (G1 drag, gravity) and moves
  while the buck moves, so lead matters. The reticle's drop marks come from the same code.
  Validation: matches factory tables for a 150 gr .308 within an inch to 400 yd (tests).
- **The buck** is ~45 shapes (ellipsoids and tapered capsules, `deer/anatomy.ts`) blended with a
  smooth minimum and meshed by surface nets at 1 cm (~34k vertices, ~1 s at load). Each shape belongs
  to a bone; skin weights come from distance to the shapes. Coat colours are rules on position and
  normal (white throat patch, belly, eye ring, muzzle band, tarsal glands…).
- **Hits** are tested against the same shapes moved by the current bone matrices (not the mesh):
  find the entry point, then follow the bullet's line through the body and collect every organ it
  crosses (`ORGANS`). The highest-ranked zone decides (`scoring.ts` ranks). Antlers are capsules.
- **Grass:** two instanced meshes: close clumps (dark at the base, per-clump colour) and distant
  clumps (evenly lit, wider, colour drifting smoothly across the field). Distant clumps with dark
  bases lined up into a "cobblestone/brick" pattern, which is why they're separate.
- **Start-up cost** (laptop, before any GPU work): ground ~1 s (includes the ground cache), foliage
  atlas ~0.4 s (from the WebP), tree models + placement ~0.7 s, impostor bake ~1 s, buck ~0.8 s.
  `?debug=1` prints the timings as `[t]` lines.
- **Animation:** foot targets come from the gait phase (stance slides back, swing arcs forward);
  legs are solved by 2-bone IK in the side plane. The front "knee" folds only in the swing; the hind
  leg's cannon stays parallel to the femur (reciprocal apparatus). Gaits blend by speed.

## Tuning knobs

| What | Where |
|---|---|
| Points per zone, bonuses, wound penalty | `game/scoring.ts` (`ZONES`, `SCORE`) |
| Rounds, magazine, bolt/reload time, zoom steps, aim sensitivity | top of `game/engine/Game.ts` |
| Bucks per hunt, spawn timing | `game/engine/Hunt.ts` |
| Buck speeds, stops, reactions, how far a hit buck runs | `game/deer/Deer.ts` |
| Range mix of where bucks appear | `pickRange` in `game/deer/routes.ts` |
| Field shape, islands, hedgerow | `game/world/layout.ts` |
| Tree species mix | `chooseSpecies` in `game/world/forest.ts` |
| Rifle/load | `LOAD_308` in `game/ballistics.ts` (reticle follows automatically) |
| Length of the hunt (sunset) | `Game.HUNT_LENGTH` in `game/engine/Game.ts`, colours in `setLight` (`world/sky.ts`) |
| Far meadow grass height | `MEADOW_HEIGHT` in `game/world/layout.ts` |
| Tone mapping / sky light strength | `Game` constructor and `init` (`?tm=aces|agx|neutral`, `?env=0.07`, `?noenv` to compare) |

## Testing

- `npm test` runs `game/*.test.ts` (ballistics, scoring, and anatomy: straight-line shots through the
  bind-pose buck must hit the heart, lungs, brain, liver, gut, legs where expected) with the map's tests.
- `/game?debug=1` exposes `window.__game` (the `Game`), logs banners/frame stats to the console, and
  disables adaptive resolution. Helpers: `__game.debugAdvance(seconds)` runs the simulation without
  drawing; `__game.debugPerfectAim(deer, offset?)` points the rifle where a perfect shot goes;
  `__game.debugView(yawDeg, pitchDeg, zoom)` looks through the scope anywhere. `window.__audio` is
  the sound module (call `unlockAudio()` first).
- `/game?autostart=1` skips the menu.
- Headless Chromium renders WebGL with SwiftShader (CPU): a frame can take seconds, so use
  `debugAdvance` instead of waiting, and long screenshot timeouts.

## Known limitations / ideas

- Photo textures came from GitHub mirrors of the Poly Haven originals (the cloud environment blocks
  polyhaven.com itself). They're CC0, so redistribution is fine; credits in `public/game/tex/CREDITS.txt`.
- Not yet tested on a real phone. Expect ~8–12 s to build the world on a recent phone. Adaptive
  resolution lowers the pixel ratio when frames are slow; shadows refresh every 2–3 frames. Through the
  scope the scene is ~0.7 M triangles.
- Ideas: does/fawns as no-shoot, wind, breathing sway, a blood trail to follow, time of day.
