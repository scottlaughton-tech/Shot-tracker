"use client";
import { useEffect, useRef, useState } from "react";
import { bearingTo, compassPoint, distance, formatDistance, norm360 } from "@/lib/geo";
import { declinationAt } from "@/lib/declination";
import { startCompass, useHeading } from "@/lib/compass";
import { BLIND_STYLE, SIGN_STYLE } from "@/lib/colors";
import type { BlindType, SignType } from "@/lib/geo";
import type { Me } from "./App";

type Loc = { lat: number; lon: number; accuracy: number | null };

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function load(key: string, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch {}
}

// ---------- Phone compass (shared with the quick shot screen and the map arrow) ----------
function useCompass() {
  const live = useHeading();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  async function start() {
    setError("");
    const r = await startCompass(); // iPhone asks permission here (must be from a tap)
    if (r === "unsupported") return setError("This device has no compass sensor. Type the bearing instead.");
    setRunning(true);
    if (r === "denied") setError("Compass permission was denied. Type the bearing instead.");
  }
  useEffect(() => {
    if (!running || live != null) return;
    const t = window.setTimeout(() => setError("No compass readings. Your phone or browser may not support it. Type the bearing instead."), 3000);
    return () => window.clearTimeout(t);
  }, [running, live]);
  // if readings arrive anyway, the compass works: hide any permission message
  return { heading: running ? live : null, error: running && live != null ? "" : error, running, start, stop: () => setRunning(false) };
}

// ---------- Form ----------
export type ReportKind = "shot" | "deer" | "sign" | "blind";
const DEER_TYPES = [
  { v: "buck", label: "Buck" }, { v: "doe", label: "Doe" },
  { v: "fawn", label: "Fawn" }, { v: "unknown", label: "Not sure" },
] as const;

export type Picked = { lat: number; lon: number } | null;

export type PickKind = "spot" | "heading";

export default function ReportForm({ me, initialKind, onClose, onSaved, picked, pickedHeading, onStartPick, hidden, startedAt }: {
  me: Me; initialKind: ReportKind; onClose: () => void; onSaved: (id: string) => void;
  /** when the person first tapped (e.g. "Heard a shot" before choosing Enter manually) */
  startedAt?: number;
  /** spot chosen with the map crosshair (deer / sign / blind) */
  picked: Picked;
  /** direction of travel drawn on the map (degrees true) */
  pickedHeading: number | null;
  /** open the map crosshair: "spot" picks a location; "heading" pulls a line from `origin` */
  onStartPick: (kind: PickKind, origin?: { lat: number; lon: number }) => void;
  /** true while the map crosshair is open: keep the form (and what's typed) but hide it */
  hidden: boolean;
}) {
  const tappedAt = useRef(startedAt ?? Date.now()).current; // moment they tapped the button
  const [kind, setKind] = useState<ReportKind>(initialKind);
  const [name, setName] = useState(() => load("st:name"));
  const [loc, setLoc] = useState<Loc | null>(null);
  const [gpsStatus, setGpsStatus] = useState("Getting your GPS location…");
  const [manual, setManual] = useState(false);
  const [where, setWhere] = useState<"me" | "map">("me");
  const [mLat, setMLat] = useState("");
  const [mLon, setMLon] = useState("");

  const [mode, setMode] = useState<"compass" | "type" | "still" | "map">(() => (load("st:mode") === "type" ? "type" : "compass"));
  const [typed, setTyped] = useState("");
  const [ref, setRef] = useState<"magnetic" | "true">(() => (load("st:ref") === "true" ? "true" : "magnetic"));
  const [locked, setLocked] = useState<number | null>(null);
  const compass = useCompass();

  const [deer, setDeer] = useState<(typeof DEER_TYPES)[number]["v"]>("buck");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [sign, setSign] = useState<SignType | null>(null);
  const [blindTitle, setBlindTitle] = useState("");
  const [blindType, setBlindType] = useState<BlindType>("tree-stand");

  const [time, setTime] = useState(() => toLocalInput(tappedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDeer = kind === "deer";
  const isBlind = kind === "blind";
  const isSign = kind === "sign";
  const noDirection = isSign || isBlind; // sign and blinds have no direction or time
  // "Not moving" only makes sense for deer
  // "Not moving" and "On map" are only offered for deer
  const dirMode = !isDeer && (mode === "still" || mode === "map") ? "compass" : mode;

  function getGps() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("GPS isn't available in this browser.");
      setManual(true);
      return;
    }
    setGpsStatus("Getting your GPS location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setGpsStatus("");
      },
      (err) => {
        setGpsStatus(err.code === 1
          ? "Location permission denied. Allow location for this site in your browser settings, or enter coordinates."
          : "Couldn't get a GPS fix. Try again, or enter coordinates.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
  }
  useEffect(() => {
    if (me) setLoc({ lat: me.lat, lon: me.lon, accuracy: me.accuracy });
    getGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPick = kind !== "shot"; // shots are located by triangulation, so always from where you stand
  const useMap = canPick && where === "map";
  // when a spot has been picked, switch to "Pick on map" automatically
  useEffect(() => { if (picked) setWhere("map"); }, [picked]);

  const myLoc: Loc | null = manual
    ? (isFinite(parseFloat(mLat)) && isFinite(parseFloat(mLon))
        // Typed longitude is treated as West (North America), with or without a minus sign.
        ? { lat: parseFloat(mLat), lon: -Math.abs(parseFloat(mLon)), accuracy: null }
        : null)
    : loc;
  const effLoc: Loc | null = useMap ? (picked ? { ...picked, accuracy: null } : null) : myLoc;

  const decl = effLoc ? declinationAt(effLoc.lat, effLoc.lon) : declinationAt(45.1, -78.3);
  const declText = `${Math.abs(decl).toFixed(1)}° ${decl < 0 ? "W" : "E"}`;

  // direction value + reference that will be submitted
  let bearing: number | null = null;
  let bearingRef: "magnetic" | "true" = "magnetic";
  if (dirMode === "compass") {
    bearing = locked;
  } else if (dirMode === "map") {
    bearing = pickedHeading;
    bearingRef = "true"; // read straight off the map: no magnetic correction
  } else if (dirMode === "type" && typed.trim() !== "" && isFinite(Number(typed))) {
    bearing = Number(typed);
    bearingRef = ref;
  }
  const trueBearing = bearing == null ? null : norm360(bearing + (bearingRef === "magnetic" ? decl : 0));

  async function submit() {
    setError("");
    const t = new Date(time).getTime();
    if (!name.trim()) return setError("Enter your first name.");
    if (!effLoc) return setError(useMap ? "Pick the spot on the map first." : "Your location is needed.");
    if (isBlind) {
      if (!blindTitle.trim()) return setError("Give the blind a name, e.g. Cedar ridge.");
    } else if (isSign) {
      if (!sign) return setError("Choose what kind of sign you found.");
    } else if (dirMode !== "still" && (bearing == null || bearing < 0 || bearing > 360)) {
      return setError(dirMode === "compass" ? "Point your phone and lock a direction."
        : dirMode === "map" ? "Draw the direction on the map." : "Enter a direction from 0 to 360.");
    }
    if (!noDirection && !isFinite(t)) return setError(isDeer ? "Enter the time you saw it." : "Enter the time you heard it.");
    setBusy(true);
    save("st:name", name.trim());
    if (!noDirection && (dirMode === "compass" || dirMode === "type")) save("st:mode", dirMode);
    save("st:ref", ref);
    const base = {
      name: name.trim(), lat: effLoc.lat, lon: effLoc.lon, accuracy: effLoc.accuracy,
      // where the person was standing when they picked a spot on the map (drawn as a dotted line for deer)
      observer: useMap && myLoc ? { lat: myLoc.lat, lon: myLoc.lon } : null,
    };
    const res = await fetch(isBlind ? "/api/blinds" : isSign ? "/api/signs" : isDeer ? "/api/sightings" : "/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isBlind
        ? { ...base, title: blindTitle.trim(), blind: blindType, note }
        : isSign
        ? { ...base, sign, note }
        : isDeer
        ? { ...base, deer, count, note, heading: dirMode === "still" ? null : bearing, headingRef: bearingRef, time: t }
        : { ...base, bearing, bearingRef, shotTime: t }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("No connection. Try again when you have signal.");
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    const saved = await res.json().catch(() => ({}));
    compass.stop();
    onSaved(saved.report?.id ?? saved.sighting?.id ?? saved.sign?.id ?? saved.blind?.id ?? "");
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} style={hidden ? { display: "none" } : undefined}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{isBlind ? "Add a blind" : isSign ? "Mark deer sign" : isDeer ? "Report a deer" : "Report a shot"}</h2>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>

        <div className="tabs kind">
          <button type="button" className={kind === "shot" ? "on" : ""} onClick={() => setKind("shot")}>🔊 Shot</button>
          <button type="button" className={isDeer ? "on" : ""} onClick={() => setKind("deer")}>🦌 Deer</button>
          <button type="button" className={isSign ? "on" : ""} onClick={() => { setKind("sign"); compass.stop(); setError(""); }}>🍂 Sign</button>
          <button type="button" className={isBlind ? "on" : ""} onClick={() => { setKind("blind"); compass.stop(); setError(""); }}>🟧 Blind</button>
        </div>

        <label>
          First name *
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scott" maxLength={40} autoComplete="given-name" />
        </label>

        <fieldset>
          <legend>1 · {kind === "shot" ? "Where you are" : isDeer ? "Where is the deer?" : isSign ? "Where is the sign?" : "Where is the blind?"}</legend>
          {canPick && (
            <div className="tabs where">
              <button type="button" className={!useMap ? "on" : ""} onClick={() => setWhere("me")}>📍 Where I am</button>
              <button type="button" className={useMap ? "on" : ""} onClick={() => { setWhere("map"); if (!picked) onStartPick("spot"); }}>🎯 Pick on map</button>
            </div>
          )}
          {useMap ? (
            picked ? (
              <div className="picked">
                <p><b>🎯 Spot picked</b>{myLoc && <> · {formatDistance(distance(myLoc.lat, myLoc.lon, picked.lat, picked.lon))} {compassPoint(bearingTo(myLoc.lat, myLoc.lon, picked.lat, picked.lon))} of you</>}</p>
                <p className="mono muted">{picked.lat.toFixed(5)}°, {picked.lon.toFixed(5)}°</p>
                <button className="btn small" type="button" onClick={() => onStartPick("spot")}>Move crosshair</button>
              </div>
            ) : (
              <button className="btn" type="button" onClick={() => onStartPick("spot")}>🎯 Open map crosshair</button>
            )
          ) : (<>
            {!manual ? (
              <>
                {loc && (
                  <p className="mono">
                    {loc.lat.toFixed(5)}°, {loc.lon.toFixed(5)}°
                    {loc.accuracy != null && <span className="muted"> ±{Math.round(loc.accuracy)} m</span>}
                  </p>
                )}
                {gpsStatus && <p className={loc ? "muted" : "warn"}>{gpsStatus}</p>}
                <div className="row gap wrap">
                  <button className="btn small" type="button" onClick={getGps}>📍 Refresh GPS</button>
                  <button className="btn small ghost" type="button" onClick={() => setManual(true)}>Enter coordinates</button>
                </div>
              </>
            ) : (
              <>
                <div className="row gap">
                  <label className="grow">Latitude (°N)<input inputMode="decimal" value={mLat} onChange={(e) => setMLat(e.target.value)} placeholder="45.0985" /></label>
                  <label className="grow">Longitude (°W)<input inputMode="decimal" value={mLon} onChange={(e) => setMLon(e.target.value)} placeholder="78.3197" /></label>
                </div>
                <button className="btn small ghost" type="button" onClick={() => setManual(false)}>Use GPS instead</button>
              </>
            )}
          </>)}
        </fieldset>

        {isBlind && (
          <fieldset>
            <legend>2 · About the blind</legend>
            <label>
              Blind name *
              <input value={blindTitle} onChange={(e) => { setBlindTitle(e.target.value); setError(""); }} maxLength={40} placeholder="e.g. Cedar ridge" />
            </label>
            <div className="chips">
              {(Object.keys(BLIND_STYLE) as BlindType[]).map((k) => (
                <button key={k} type="button" className={blindType === k ? "on blind" : ""} onClick={() => setBlindType(k)}>
                  {BLIND_STYLE[k].label}
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Note (optional), e.g. faces the creek, good for west wind" />
            {!useMap && <p className="hint">Stand at the blind, or use <b>🎯 Pick on map</b> above if you&apos;re adding it from somewhere else.</p>}
          </fieldset>
        )}

        {isSign && (
          <fieldset>
            <legend>2 · What kind of sign</legend>
            <div className="chips">
              {(Object.keys(SIGN_STYLE) as SignType[]).map((k) => (
                <button key={k} type="button" className={sign === k ? "on" : ""} onClick={() => { setSign(k); setError(""); }}>
                  {SIGN_STYLE[k].label}
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Note (optional), e.g. fresh, still wet" />
            {!useMap && <p className="hint">Marked where you&apos;re standing. Or use <b>🎯 Pick on map</b> above.</p>}
          </fieldset>
        )}

        {isDeer && (
          <fieldset>
            <legend>2 · What you saw</legend>
            <div className="tabs">
              {DEER_TYPES.map((d) => (
                <button key={d.v} type="button" className={deer === d.v ? "on" : ""} onClick={() => setDeer(d.v)}>{d.label}</button>
              ))}
            </div>
            <div className="row gap">
              <span className="grow">How many</span>
              <button type="button" className="btn small" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Fewer">−</button>
              <strong className="count">{count}</strong>
              <button type="button" className="btn small" onClick={() => setCount((c) => Math.min(50, c + 1))} aria-label="More">+</button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Note (optional), e.g. 8 point, crossing creek" />
          </fieldset>
        )}

        {!noDirection && (<>
        <fieldset>
          <legend>{isDeer ? "3 · Which way it's heading" : "2 · Direction the sound came from"}</legend>
          <div className={`tabs ${isDeer ? "grid2" : ""}`}>
            <button type="button" className={dirMode === "compass" ? "on" : ""} onClick={() => setMode("compass")}>🧭 Point phone</button>
            <button type="button" className={dirMode === "type" ? "on" : ""} onClick={() => { setMode("type"); compass.stop(); }}>⌨️ Type</button>
            {isDeer && (
              <button type="button" className={dirMode === "map" ? "on" : ""} onClick={() => {
                setMode("map"); compass.stop();
                if (pickedHeading == null && effLoc) onStartPick("heading", { lat: effLoc.lat, lon: effLoc.lon });
              }}>🗺 On map</button>
            )}
            {isDeer && (
              <button type="button" className={dirMode === "still" ? "on" : ""} onClick={() => { setMode("still"); compass.stop(); }}>Not moving</button>
            )}
          </div>

          {dirMode === "compass" && (
            <div className="compass">
              {!compass.running ? (
                <button type="button" className="btn" onClick={compass.start}>Start compass</button>
              ) : (
                <>
                  <div className="heading-readout">
                    {compass.heading == null ? "…" : `${Math.round(compass.heading)}°`}
                    <small>{compass.heading == null ? "" : compassPoint(compass.heading)}</small>
                  </div>
                  <button type="button" className="btn primary" disabled={compass.heading == null}
                    onClick={() => setLocked(compass.heading)}>
                    Lock this direction
                  </button>
                </>
              )}
              <p className="hint">
                Hold the phone <b>flat</b> with the <b>top edge pointing {isDeer ? "the way the deer is going" : "at the sound"}</b>.
                Keep it away from your rifle and other metal, which throws the compass off.
              </p>
              {compass.error && <p className="warn">{compass.error}</p>}
              {locked != null && <p className="ok">Locked: {Math.round(locked)}° magnetic</p>}
            </div>
          )}
          {dirMode === "type" && (
            <div className="stack">
              <div className="row gap">
                <input className="grow" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 235" aria-label="Direction in degrees" />
                <span>°</span>
              </div>
              <div className="tabs small">
                <button type="button" className={ref === "magnetic" ? "on" : ""} onClick={() => setRef("magnetic")}>Magnetic</button>
                <button type="button" className={ref === "true" ? "on" : ""} onClick={() => setRef("true")}>True north</button>
              </div>
              <p className="hint">Most compasses and phone compass apps show <b>magnetic</b> unless you changed a setting.</p>
            </div>
          )}
          {dirMode === "map" && (
            <div className="stack">
              {!effLoc ? (
                <p className="warn">Set where the deer is (step 1) first.</p>
              ) : (
                <button type="button" className="btn" onClick={() => onStartPick("heading", { lat: effLoc.lat, lon: effLoc.lon })}>
                  {pickedHeading == null ? "🗺 Draw direction on map" : "🗺 Redraw on map"}
                </button>
              )}
              <p className="hint">The map opens on the deer. Drag it to pull a line the way the deer went.</p>
            </div>
          )}
          {dirMode === "still" && <p className="muted">Standing, feeding or bedded. No direction needed.</p>}
          {dirMode !== "still" && trueBearing != null && (
            <p className="muted">
              = <b>{Math.round(trueBearing)}° true ({compassPoint(trueBearing)})</b>
              {bearingRef === "magnetic" && ` · declination ${declText} applied`}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>{isDeer ? "4 · When you saw it" : "3 · When you heard it"}</legend>
          <input type="datetime-local" step={1} value={time} onChange={(e) => setTime(e.target.value)} />
          <div className="row gap wrap">
            {[0, 0.5, 1, 2, 5].map((m) => (
              <button key={m} type="button" className="btn small" onClick={() => setTime(toLocalInput(tappedAt - m * 60000))}>
                {m === 0 ? "When I tapped" : m < 1 ? "30 s before" : `${m} min before`}
              </button>
            ))}
          </div>
        </fieldset>
        </>)}

        {error && <p className="error">{error}</p>}
        <button className="btn primary big" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
      </div>
    </div>
  );
}
