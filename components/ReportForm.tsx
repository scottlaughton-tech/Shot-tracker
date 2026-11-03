"use client";
import { useEffect, useRef, useState } from "react";
import { compassPoint, norm360 } from "@/lib/geo";
import { declinationAt } from "@/lib/declination";
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

// ---------- Phone compass ----------
type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };

function useCompass() {
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const smooth = useRef<{ s: number; c: number } | null>(null);
  const cleanup = useRef<() => void>(() => {});

  async function start() {
    setError("");
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceOrientationEvent;
    if (!DOE) return setError("This device has no compass sensor. Type the bearing instead.");
    try {
      if (typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission(); // iPhone asks permission here
        if (r !== "granted") return setError("Compass permission was denied. Type the bearing instead.");
      }
    } catch {
      return setError("Couldn't access the compass. Type the bearing instead.");
    }

    const handler = (e: Event) => {
      const ev = e as OrientationEvt;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === "number") h = ev.webkitCompassHeading; // iOS (magnetic)
      else if (ev.absolute && ev.alpha != null) {
        h = 360 - ev.alpha; // Android (magnetic)
        h += (screen.orientation?.angle ?? 0);
      }
      if (h == null || isNaN(h)) return;
      const r = (h * Math.PI) / 180;
      const prev = smooth.current;
      const s = prev ? prev.s * 0.8 + Math.sin(r) * 0.2 : Math.sin(r);
      const c = prev ? prev.c * 0.8 + Math.cos(r) * 0.2 : Math.cos(r);
      smooth.current = { s, c };
      setHeading(norm360((Math.atan2(s, c) * 180) / Math.PI));
    };
    const evName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(evName, handler);
    cleanup.current = () => window.removeEventListener(evName, handler);
    setRunning(true);
    window.setTimeout(() => {
      if (smooth.current == null) setError("No compass readings. Your phone or browser may not support it. Type the bearing instead.");
    }, 3000);
  }

  function stop() {
    cleanup.current();
    setRunning(false);
  }
  useEffect(() => () => cleanup.current(), []);
  return { heading, error, running, start, stop };
}

// ---------- Form ----------
export type ReportKind = "shot" | "deer";
const DEER_TYPES = [
  { v: "buck", label: "Buck" }, { v: "doe", label: "Doe" },
  { v: "fawn", label: "Fawn" }, { v: "unknown", label: "Not sure" },
] as const;

export default function ReportForm({ me, initialKind, onClose, onSaved }: {
  me: Me; initialKind: ReportKind; onClose: () => void; onSaved: (id: string) => void;
}) {
  const tappedAt = useRef(Date.now()).current; // moment they tapped the button
  const [kind, setKind] = useState<ReportKind>(initialKind);
  const [name, setName] = useState(() => load("st:name"));
  const [loc, setLoc] = useState<Loc | null>(null);
  const [gpsStatus, setGpsStatus] = useState("Getting your GPS location…");
  const [manual, setManual] = useState(false);
  const [mLat, setMLat] = useState("");
  const [mLon, setMLon] = useState("");

  const [mode, setMode] = useState<"compass" | "type" | "still">(() => (load("st:mode") === "type" ? "type" : "compass"));
  const [typed, setTyped] = useState("");
  const [ref, setRef] = useState<"magnetic" | "true">(() => (load("st:ref") === "true" ? "true" : "magnetic"));
  const [locked, setLocked] = useState<number | null>(null);
  const compass = useCompass();

  const [deer, setDeer] = useState<(typeof DEER_TYPES)[number]["v"]>("buck");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");

  const [time, setTime] = useState(() => toLocalInput(tappedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDeer = kind === "deer";
  // "Not moving" only makes sense for deer
  const dirMode = !isDeer && mode === "still" ? "compass" : mode;

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

  const effLoc: Loc | null = manual
    ? (isFinite(parseFloat(mLat)) && isFinite(parseFloat(mLon))
        // Typed longitude is treated as West (North America), with or without a minus sign.
        ? { lat: parseFloat(mLat), lon: -Math.abs(parseFloat(mLon)), accuracy: null }
        : null)
    : loc;

  const decl = effLoc ? declinationAt(effLoc.lat, effLoc.lon) : declinationAt(45.1, -78.3);
  const declText = `${Math.abs(decl).toFixed(1)}° ${decl < 0 ? "W" : "E"}`;

  // direction value + reference that will be submitted
  let bearing: number | null = null;
  let bearingRef: "magnetic" | "true" = "magnetic";
  if (dirMode === "compass") {
    bearing = locked;
  } else if (dirMode === "type" && typed.trim() !== "" && isFinite(Number(typed))) {
    bearing = Number(typed);
    bearingRef = ref;
  }
  const trueBearing = bearing == null ? null : norm360(bearing + (bearingRef === "magnetic" ? decl : 0));

  async function submit() {
    setError("");
    const t = new Date(time).getTime();
    if (!name.trim()) return setError("Enter your first name.");
    if (!effLoc) return setError("Your location is needed.");
    if (dirMode !== "still" && (bearing == null || bearing < 0 || bearing > 360)) {
      return setError(dirMode === "compass" ? "Point your phone and lock a direction." : "Enter a direction from 0 to 360.");
    }
    if (!isFinite(t)) return setError(isDeer ? "Enter the time you saw it." : "Enter the time you heard it.");
    setBusy(true);
    save("st:name", name.trim());
    if (dirMode !== "still") save("st:mode", dirMode);
    save("st:ref", ref);
    const base = { name: name.trim(), lat: effLoc.lat, lon: effLoc.lon, accuracy: effLoc.accuracy };
    const res = await fetch(isDeer ? "/api/sightings" : "/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isDeer
        ? { ...base, deer, count, note, heading: dirMode === "still" ? null : bearing, headingRef: bearingRef, time: t }
        : { ...base, bearing, bearingRef, shotTime: t }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("No connection. Try again when you have signal.");
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    const saved = await res.json().catch(() => ({}));
    compass.stop();
    onSaved(saved.report?.id ?? saved.sighting?.id ?? "");
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{isDeer ? "Report a deer" : "Report a shot"}</h2>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>

        <div className="tabs kind">
          <button type="button" className={!isDeer ? "on" : ""} onClick={() => setKind("shot")}>🔊 Shot heard</button>
          <button type="button" className={isDeer ? "on" : ""} onClick={() => setKind("deer")}>🦌 Deer seen</button>
        </div>

        <label>
          First name *
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scott" maxLength={40} autoComplete="given-name" />
        </label>

        <fieldset>
          <legend>1 · Where you are</legend>
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
        </fieldset>

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

        <fieldset>
          <legend>{isDeer ? "3 · Which way it's heading" : "2 · Direction the sound came from"}</legend>
          <div className="tabs">
            <button type="button" className={dirMode === "compass" ? "on" : ""} onClick={() => setMode("compass")}>🧭 Point phone</button>
            <button type="button" className={dirMode === "type" ? "on" : ""} onClick={() => { setMode("type"); compass.stop(); }}>⌨️ Type</button>
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

        {error && <p className="error">{error}</p>}
        <button className="btn primary big" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
      </div>
    </div>
  );
}
