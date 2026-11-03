"use client";
// "Heard a shot" fast path: point the phone at the sound and tap REGISTER.
// The time is the moment the button on the map was tapped; GPS + live compass are sent together.
import { useEffect, useState } from "react";
import { compassPoint, norm360 } from "@/lib/geo";
import { declinationAt } from "@/lib/declination";
import { compassAccuracy, useHeading } from "@/lib/compass";
import type { Me } from "./App";

type Status = "ok" | "denied" | "unsupported";

function load(key: string) { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }
function save(key: string, v: string) { try { localStorage.setItem(key, v); } catch {} }

export default function QuickShot({ me, tappedAt, compass, onManual, onClose, onSaved }: {
  me: Me;
  tappedAt: number;
  /** result of startCompass(), started from the "Heard a shot" tap */
  compass: Promise<Status>;
  onManual: () => void;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const heading = useHeading(); // magnetic
  const [status, setStatus] = useState<Status | "waiting">("waiting");
  const [noReadings, setNoReadings] = useState(false);
  const [name, setName] = useState(() => load("st:name"));
  const [askName] = useState(() => !load("st:name"));
  const [loc, setLoc] = useState<{ lat: number; lon: number; accuracy: number } | null>(me);
  const [gpsMsg, setGpsMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { compass.then(setStatus); }, [compass]);
  useEffect(() => { if (me) setLoc(me); }, [me]);
  useEffect(() => {
    // fresh GPS fix for this report
    if (!("geolocation" in navigator)) return setGpsMsg("GPS isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }); setGpsMsg(""); },
      (err) => setGpsMsg(err.code === 1 ? "Location is blocked for this site. Use Enter manually or allow location." : "Still looking for GPS…"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 },
    );
  }, []);
  useEffect(() => {
    if (status !== "ok" || heading != null) return;
    const t = window.setTimeout(() => setNoReadings(true), 3000);
    return () => window.clearTimeout(t);
  }, [status, heading]);

  const decl = loc ? declinationAt(loc.lat, loc.lon) : 0;
  const trueH = heading == null ? null : norm360(heading + decl);
  const acc = compassAccuracy();
  const needsCalibration = acc != null && (acc < 0 || acc > 25);
  // Trust actual readings over what the browser says about permission.
  const compassProblem = heading != null ? null
    : status === "denied" ? "Compass access was blocked. On iPhone: close and reopen the page, then tap Allow when asked."
    : status === "unsupported" || noReadings ? "This phone or browser isn't giving compass readings."
    : null;

  async function register() {
    setError("");
    if (!name.trim()) return setError("Enter your first name first.");
    if (!loc) return setError("Waiting for your GPS location…");
    if (heading == null) return setError("No compass reading yet.");
    setBusy(true);
    save("st:name", name.trim());
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(), lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy,
        bearing: heading, bearingRef: "magnetic", shotTime: tappedAt,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("No connection. Try again when you have signal.");
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    const saved = await res.json().catch(() => ({}));
    onSaved(saved.report?.id ?? "");
  }

  const heardAt = new Date(tappedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const ready = !!loc && heading != null && !!name.trim() && !busy;

  return (
    <div className="qs">
      <div className="qs-top">
        <span>🔊 Shot heard at <b>{heardAt}</b></span>
        <button className="qs-x" onClick={onClose} aria-label="Cancel">✕</button>
      </div>

      {askName && (
        <label className="qs-name">
          Your first name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scott" maxLength={40} autoComplete="given-name" />
        </label>
      )}

      <p className="qs-instr">Point the <b>top of your phone</b> toward the shot</p>

      {compassProblem ? (
        <div className="qs-problem">
          <p>{compassProblem}</p>
          <button className="btn primary big" onClick={onManual}>Enter manually</button>
        </div>
      ) : (
        <>
          <div className="qs-dial" aria-hidden>
            <div className="qs-rose" style={{ transform: `rotate(${-(trueH ?? 0)}deg)` }}>
              <span className="n">N</span><span className="e">E</span><span className="s">S</span><span className="w">W</span>
            </div>
            <div className="qs-pointer" />
          </div>
          <div className="qs-readout" aria-live="polite">
            {trueH == null ? "…" : `${Math.round(trueH)}°`}
            <small>{trueH == null ? "Waiting for compass" : compassPoint(trueH)}</small>
          </div>
          <p className="qs-hint">
            Hold the phone flat, away from your rifle.
            {needsCalibration && <b> Compass needs calibrating: wave the phone in a figure 8.</b>}
          </p>
        </>
      )}

      <div className="qs-gps">
        {loc ? <>📍 GPS ±{Math.round(loc.accuracy)} m</> : <>📍 {gpsMsg || "Getting your GPS location…"}</>}
      </div>

      {error && <p className="qs-error">{error}</p>}

      {!compassProblem && (
        <button className="qs-register" disabled={!ready} onClick={register}>
          {busy ? "Sending…" : "REGISTER SHOT"}
        </button>
      )}
      <button className="qs-manual" onClick={onManual}>Enter manually</button>
    </div>
  );
}
