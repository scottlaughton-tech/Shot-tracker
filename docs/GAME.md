# Last Light – the hunting game (developer guide)

A web-based deer hunting game inside Shot Tracker, opened by tapping the 🦌 in the map's top-left
corner (route `/game`, behind the same party passcode). Landscape, touch controls, one hand aims
and the other fires. The terrain, trees, grass, the buck and all sounds are generated in code at
load time: there are no 3D model or audio files. The only image files are CC0 photo textures
(ground, bark, rock) and a pre-drawn copy of the code-drawn foliage atlas, in `public/game/tex/`.

## How it plays

- The player sits in a ladder stand (eye 4.2 m above the ground) on the south edge of an old
  field near Bancroft. The field runs ~1 km north, rising gently away from the stand.
- **Tap** anywhere (not on a button) → the scope opens there, centred over the spot, and **stays up**.
  **Slide** to aim (relative, like a trackpad; sensitivity scales with magnification, quick swipes are
  accelerated). A quick **tap outside the circle** moves the scope there; **✕** (or Escape) lowers it.
  Around the scope the open view is shown as a dimmed, greyed still taken when the scope came up
  (re-rendering it live would cost a second full render, and the tree/grass detail is set up for
  the scope view by then). The circle sits over the spot it's looking at, kept clear of the buttons.
- **Controls screen** (`ControlsCard` in GameRoot, `game/ui/controls.ts`, saved in localStorage
  `st:game-controls` per phone): **Normal** (slide right → aim right, gain 0.65 scope widths per scope
  width) or **Reversed** = drag the view (the picture follows the finger 1:1, so the aim moves the
  other way: `Game.dragView`), and **Aim speed** Slow/Normal/Fast (×0.6/1/1.6, `Game.aimSpeed`). The
  finger speed used for acceleration is smoothed across touch events and reset at each new slide.
- **FIRE** (right thumb), **+ / −** magnification 4–16×. Desktop: hold the mouse, Space/F fires, +/− zoom.
- Unlimited ammunition: 5 in the rifle, then a 3.2 s reload. 1.25 s bolt cycle between shots.
- **Levels** (`LEVELS` in `game/engine/Hunt.ts`): one buck at a time. Level 1 stands broadside at
  70–130 m; each buck you drop moves you up (farther, walking → trotting → some running, shorter
  stands). Bucks wait just inside cover close to the level's range band (cover inside the band is
  preferred), step out ~2 s after they're sent, and trot/walk a short way (≤ ~45 m) to a spot in the
  band (`makeRoute` returns that spot as `poseAt`); easy ones stand broadside there. Then one leg
  across the field and out. The next buck is sent 2–3.5 s after the last one is down or gone.
- **Buck out!** When a buck steps out of cover (`DeerEvents.out`), `Hunt` shows a banner with his side
  (`sideOf`) and `Game` plays a soft chime panned his way and draws a marker for 3.5 s: a pulsing
  ring on him in the open view, or, through the scope when he isn't in it, an arrow on the rim
  pointing to him (`Game.drawAlerts`).
- **Turbo** (menu choice, remembered per phone in `st:game-mode`; `Hunt.mode`): each level is
  `TURBO_TIME` = 60 s to drop `quota` bucks (`TURBO` table in Hunt.ts: 3, 4, 5 … 10). Up to `atOnce`
  are out at the same time (never more than are still needed + 1), a new one every `every` s, and
  `tier` picks the Classic level whose ranges/speeds/light apply (standing time halved, no feeding
  stops). Make the quota: +`TIME_BONUS` (15) points per whole second left, the rest are spooked
  (`Deer.spook`), 3.5 s break, next level. Clock hits zero: bucks already hit hard still count when
  they drop (overtime); otherwise "Time's up" and the hunt is over. No strikes; a wounded buck that
  gets away still costs 75. The top bar shows the clock (red under 10 s) and bucks down / quota; the
  last 5 seconds tick. No "Buck out!" banner in Turbo (the chime and marker are enough). Separate
  leaderboard. `/game?autostart=1&turbo=1` starts a Turbo hunt straight away (testing).
- **Keeping bucks in sight:** everything they do in the open happens within ±30° (`VIEW` in
  routes.ts; the open view shows ±35° and the buttons cover part of the right). Their spot and legs
  must be ≥ 10 m from the bush edge and clear of the hedgerow and swale along the whole walk
  (`clearPath`). They wait 5 m inside the cover, and leaving (or fleeing) they're gone 6–8 m in.
  **Line of sight:** `seenFromStand(x, z)` walks the sight line from the stand's eye (4.2 m up) to a
  buck's chest; any bush or island on it (edge distance < 0; their trees are far taller than the
  line), or ground above it, hides him. The cleared shooting lane (first 55 m) and the last 6 m
  don't count. Cover points carry `seen` (tested 3 m out), only seen ones are used, and every
  point of the walk in the open is checked too. Before this, bucks came out of the back of a
  clump and stood behind it. Unit-tested in `game/deer/routes.test.ts` (npm test loads game
  modules through `scripts/ts-resolve.mjs`).
- **Strikes:** a buck that was in the field when you fired and then gets away (missed or wounded) is a
  strike; three ends the hunt. A buck you never shot at doesn't count, and another one comes.
- **⛶ Full screen:** Fullscreen API + landscape lock where allowed (Android, desktop). iPhone Safari
  has no element full screen, so the button explains Add to Home Screen; `/game` carries
  apple-mobile-web-app-capable so the home-screen copy opens without Safari's bars (and the login page
  sends you back to `/game` via `?next=`).
- **Last light:** the sun sinks with the level (`Hunt.dusk`, eased in `Game`), so the long shots of the
  later levels are in warmer, dimmer light.
- No range help: the reticle has a deer ranging scale. Misses say how far off the shot was and how
  far away the buck really was ("40 cm low – he was 310 m away").
- Wounded bucks run for cover. If they reach it: −75 points.
- Sounds are stereo-panned by direction: grunts from cruising bucks, a stick snapping when one steps
  out of the bush, alarm snorts, hit "whops". The pause button (and leaving the app) pauses the hunt.
- The results screen shows each buck hit with a side-view diagram of the vitals and the bullet holes.

## Files

```
app/game/page.tsx          auth check → <GameShell/> (landscape viewport, no zoom)
app/game/debug/page.tsx    developer previews: /game/debug?show=atlas|bark|trees|deer|deer:row|deer:walk|deer:trot|deer:run|deer:dead|deer:front|deer:quarter
app/api/game/scores/       GET top 20 (?mode=classic|turbo) · POST a finished hunt with its mode
lib/store.ts               topScores/addScore: Redis sorted sets "shot-tracker:game-scores" (Classic) and
                           "shot-tracker:game-scores:turbo" (Turbo) (kept apart
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
  - Vegetation is rebuilt only when the view has moved ~18% of its width (`Game.refreshVegetation`),
    and while sweeping the trees and the grass take turns (one per frame) so no frame does both.
    Each rebuild uploads only the instances in use (`world/instances.ts`; re-sending whole buffers
    was ~10 MB per rebuild and made sweeps stutter), the tree test uses per-tree values worked out
    once (`Forest.prepare`), and grass scans only the part of each grid row inside the view wedge.
    Worst frame in a scope sweep: ~3–4 ms of CPU on a desktop (was 15–30 ms).
  - The sun is low (WSW), so trees just outside the view still cast shadows into it: `Forest.update`
    also keeps (as impostors) trees whose shadow reaches the view (`ShadowReach`). Without this,
    shadows (and the shading of trees in view) switched on and off as the scope swept.
  - Every tree's scale must be positive: a negative scale (once produced for hedgerow/swale trees out
    in the field) flips full models underground and breaks the view test, so those trees popped in
    and out through the scope.
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
| Levels (ranges, speeds, stands, running chance), strikes, spawn timing | `LEVELS`, `STRIKES` in `game/engine/Hunt.ts` |
| Buck speeds, stops, reactions, how far a hit buck runs | `game/deer/Deer.ts` |
| Where bucks come from / walk to | `makeRoute` in `game/deer/routes.ts`, cover clumps in `ISLANDS` (`layout.ts`) |
| Field shape, islands, hedgerow | `game/world/layout.ts` |
| Tree species mix | `chooseSpecies` in `game/world/forest.ts` |
| Rifle/load | `LOAD_308` in `game/ballistics.ts` (reticle follows automatically) |
| Sunset per level | `Hunt.dusk` (level 10 = nearly down), colours in `setLight` (`world/sky.ts`) |
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

## Status (keep this up to date)

- Live on main since Nov 2026. Owner feedback handled: difficulty ramps by level (3 strikes),
  scope opens where you tap and stays up, full-screen button; then (first real-phone test) trees
  popping in the scope fixed, faster pace (bucks out ~2 s after being sent, short walk to their
  spot, 2–3.5 s between bucks), and a "Buck out!" alert (banner, chime, ring / scope-rim arrow).
  Then (party feedback): Controls screen with reversed slide (drag the view) and aim speed, and much
  cheaper vegetation rebuilds so sweeping the scope is smooth. Then: Turbo mode (own leaderboard),
  and bucks kept in sight (within ±30°, out in the open, not lingering in the bush). Then: bucks
  never come out of or stand behind cover (line-of-sight rule), and the brush clump 95 m out on the
  right was removed (it hid a wedge of the field).
- Waiting on the owner's real-phone test: load time, smoothness (open view and scope), aim speed,
  whether level 1 is easy enough, sound, anything that looks wrong. Tune from their answers.
- Test scripts used during development (Playwright, SwiftShader) lived in the session scratchpad and
  are not in the repo; the debug helpers above (`?debug=1`, `debugAdvance`, `debugView`,
  `debugPerfectAim`) are enough to rebuild them.

## Known limitations / ideas

- Photo textures came from GitHub mirrors of the Poly Haven originals (the cloud environment blocks
  polyhaven.com itself). They're CC0, so redistribution is fine; credits in `public/game/tex/CREDITS.txt`.
- Not yet tested on a real phone. Expect ~8–12 s to build the world on a recent phone. Adaptive
  resolution lowers the pixel ratio when frames are slow; shadows refresh every 2–3 frames. Through the
  scope the scene is ~0.7 M triangles.
- Ideas: does/fawns as no-shoot, wind, breathing sway, a blood trail to follow, time of day.
