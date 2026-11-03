# 🦌 Shot Tracker

A web app for a hunting party. When someone hears a shot, they report:

- their **first name**
- their **GPS location** (the phone asks permission)
- the **compass bearing** the sound came from (point the phone, or type degrees)
- the **time** they heard it

Reports heard within a few minutes of each other (adjustable) are treated as the
**same shot**. Each shot gets its own colour on a topographic map. With 2+ reports,
the app estimates where the shot came from and draws a 95% "probably in here" area.

## Deploying to Vercel (one-time setup)

1. **Import the repo.** Go to <https://vercel.com/new>, sign in with GitHub, pick
   `shot-tracker` and click **Deploy**. You can leave every setting as it is.
2. **Set the party passcode.** In the Vercel project, open **Settings → Environment Variables**
   and add `PARTY_PASSCODE` with whatever code you'll give the party (e.g. `buck2026`).
   Capital letters don't matter when people type it in.
3. **Add the database.** Open the **Storage** tab (or **Marketplace**), choose **Upstash → Redis**,
   create it on the free plan, and **connect it to this project**. Vercel adds the
   connection settings automatically.
4. **Redeploy** so the new settings take effect: **Deployments** → **⋯** on the latest deployment → **Redeploy**.
5. Share the URL (e.g. `https://shot-tracker-xyz.vercel.app`) and the passcode with your party.
   Tip: on iPhone, tap Share → **Add to Home Screen** so it opens like an app.

Until steps 2–4 are done, the site shows a warning (no passcode, or reports are temporary).

## Using it in the field

- Tap **🔊 I heard a shot** right away. The time is captured at that moment, and you
  can adjust it if you're reporting late.
- **Point phone:** tap *Start compass*, hold the phone **flat**, point the **top edge**
  at the sound, then tap *Lock this direction*. Keep it away from your rifle, because
  steel throws off phone compasses.
- **Type degrees:** use a real compass. Choose **Magnetic** (most compasses) or **True north**.
  Magnetic readings are corrected automatically (around Bancroft ON the correction is about 11° W).
- **🦌 Deer button:** report a buck, doe or fawn sighting at your location, with how many,
  which way it's heading (same "Point phone" or "Type" input, or **Not moving**) and an optional note.
  Sightings show on the map as lettered markers (B, D, F) with dashed arrows. Older sightings fade.
  In the list panel you can turn them on or off and choose **Last 48 h** or **All days**.
- **🍂 Sign button:** mark deer sign where you're standing: ground scrape, tree scrape (rub),
  droppings, tracks or a bed, with an optional note. Shown as purple diamonds (Sc, Rb, Dp, Tk, Bd).
- **Blinds:** in the list panel tap **＋ Add a blind** (or choose **Blind** in the report form).
  Give it a name, pick tree stand / ladder stand / ground blind / box blind / other, and stand at it
  (or type coordinates). Blinds show as orange squares with their name always visible.
- **Clearing:** shots, deer sightings, deer sign and blinds each have their own "Clear all" button
  (tap **Edit** in the Layers panel, then look at the bottom of that tab).
- **🎯 Pick on map (deer, sign, blinds):** in step 1 choose **Pick on map** instead of **Where I am**.
  Drag the map (or tap a spot) to put the crosshair on the spot; the readout shows how far and which
  way it is from you. Tap **✓ Use this spot** to return to the form. For deer, a dotted line shows
  where it was spotted from.
- **📍 My location** (right side of the map): jumps the map to where you are.
- **📏 Ruler:** tap it, then tap the map to add points along a path. Each point shows the running
  distance and the bar at the bottom shows the total. **Start from me** begins at your position,
  **↶ Undo** removes the last point, **Done** closes the ruler.
- **🗺 Direction on map (deer):** in "Which way it's heading" choose **On map**. The map opens on
  the deer; drag it (or tap) to pull a line the way the deer went, then **✓ Use this direction**.
- **Alerts:** when someone else reports a shot or a deer, a pop-up appears (Android also vibrates).
  Tap 🔕 in the top bar to also play a beep.
- **☰ Layers panel:**
  - Top: four big switches (**Shots, Deer, Sign, Blinds**) turn each layer on or off on the map with one tap.
  - Below: tabs show one detailed list at a time. Tap a row to zoom to it. On the Shots tab, tap the
    colored dot to show or hide one shot's lines, or ▾ to see who reported it.
  - Deleting is locked until you tap **Edit**. Then 🗑 buttons and **Clear all** appear.
- **Group** (top bar): how many minutes apart reports can be and still count as one shot.
  This setting is shared with the whole party.

### How accurate is it?

Bearings to sound in the woods are rough. Echoes off hills and lakes are common, so the math
assumes each bearing is off by about ±5°. The shaded area grows when the lines disagree.
Three or more reports from people spread out to the side give much better results than
two people standing close together.

## For developers

```bash
npm install
npm run dev        # http://localhost:3000. No passcode and an in-memory database when run locally
npm test           # triangulation unit tests
```

- `lib/geo.ts`: grouping and weighted least-squares triangulation
- `lib/declination.ts`: magnetic declination (World Magnetic Model 2025)
- `lib/store.ts`: Upstash Redis storage (falls back to memory)
- `components/`: map (Leaflet + OpenTopoMap / Esri satellite), report form, shot list
