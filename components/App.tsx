"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bearingTo, compassPoint, distance, formatDistance, groupShots, triangulate, type Report, type Fix, type Shot, type Sighting, type Sign, type Blind } from "@/lib/geo";
import { colorFor, DEER_STYLE, deerText, SIGN_COLOR, SIGN_STYLE, BLIND_COLOR, BLIND_STYLE } from "@/lib/colors";
import { beep, unlockAudio, vibrate } from "@/lib/alert";
import { ago } from "@/lib/time";
import QuickShot from "./QuickShot";
import { listenCompass, needsPermission, previouslyGranted, startCompass } from "@/lib/compass";
import ReportForm, { type Picked, type PickKind, type ReportKind } from "./ReportForm";
import ShotList, { type LayerKey, type Layers } from "./ShotList";

const ShotMap = dynamic(() => import("./ShotMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

export type Me = { lat: number; lon: number; accuracy: number } | null;
export type ShotView = Shot & { color: string; fix: Fix | null };

const INTERVALS = [0.5, 1, 2, 3, 5, 10, 15, 30];

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  // Which layers are on the map (remembered per phone).
  const [layers, setLayers] = useState<Layers>({ shots: true, deer: true, sign: true, blinds: true });
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("st:layers") ?? "null"); if (v) setLayers((l) => ({ ...l, ...v })); } catch {}
  }, []);
  function setLayer(k: LayerKey, on: boolean) {
    setLayers((l) => {
      const n = { ...l, [k]: on };
      try { localStorage.setItem("st:layers", JSON.stringify(n)); } catch {}
      return n;
    });
  }
  const [deerRange, setDeerRange] = useState<"recent" | "all">("all");
  const [signs, setSigns] = useState<Sign[]>([]);
  const [blinds, setBlinds] = useState<Blind[]>([]);
  const [intervalMin, setIntervalMin] = useState(2);
  const [hasDatabase, setHasDatabase] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<Me>(null);
  const [formKind, setFormKind] = useState<ReportKind | null>(null);
  const [formStartedAt, setFormStartedAt] = useState<number | undefined>(undefined);
  // Quick shot screen: opened by "Heard a shot"
  const [quick, setQuick] = useState<{ tappedAt: number; compass: Promise<"ok" | "denied" | "unsupported"> } | null>(null);
  function heardShot() {
    // startCompass() must run inside the tap so iPhone can ask for compass permission
    setQuick({ tappedAt: Date.now(), compass: startCompass() });
  }

  // Compass arrow on the blue dot: Android needs no permission, so start right away.
  // iPhone needs a tap; if it was allowed before, restart quietly on the first tap anywhere.
  useEffect(() => {
    listenCompass();
    if (!needsPermission() || !previouslyGranted()) return;
    const once = () => { void startCompass(); window.removeEventListener("pointerdown", once); };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);
  // Map crosshair ("Pick on map") for deer, sign and blinds
  const [pickMode, setPickMode] = useState<PickKind | null>(null);
  const picking = pickMode !== null;
  const setPicking = (on: boolean) => { if (!on) setPickMode(null); };
  const [picked, setPicked] = useState<Picked>(null);
  // "On map" direction for deer: a line pulled from the deer (aimFrom) to the crosshair
  const [aimFrom, setAimFrom] = useState<{ lat: number; lon: number } | null>(null);
  const [pickedHeading, setPickedHeading] = useState<number | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  function openForm(k: ReportKind, startedAt?: number) {
    setFormStartedAt(startedAt); setPicked(null); setPickedHeading(null); setPicking(false); setRuler(null); setFormKind(k); }

  // "My location" button
  const [goto, setGoto] = useState<{ lat: number; lon: number; n: number } | null>(null);
  const [locating, setLocating] = useState(false);
  function locateMe() {
    void startCompass(); // also turns on the direction arrow (asks on iPhone)
    if (me) return setGoto((g) => ({ lat: me.lat, lon: me.lon, n: (g?.n ?? 0) + 1 }));
    if (!("geolocation" in navigator)) return alert("This browser can't share your location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMe({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setGoto((g) => ({ lat: p.coords.latitude, lon: p.coords.longitude, n: (g?.n ?? 0) + 1 }));
      },
      (err) => {
        setLocating(false);
        alert(err.code === 1
          ? "Location is blocked for this site. Allow it in your browser settings (on iPhone: Settings → Safari → Location)."
          : "Couldn't get a GPS fix. Try again in a moment.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
  }

  // Ruler: null = off, otherwise the points tapped so far
  const [ruler, setRuler] = useState<[number, number][] | null>(null);
  const rulerTotal = (ruler ?? []).reduce((t, p, i, a) => (i ? t + distance(a[i - 1][0], a[i - 1][1], p[0], p[1]) : 0), 0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<{ text: string; sub: string; key: string; color: string } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const soundRef = useRef(false);
  const seen = useRef<Set<string> | null>(null); // report ids already known (null = first load)
  const toastTimer = useRef<number | undefined>(undefined);

  // Sound preference (remembered per phone). Off by default so a phone doesn't beep in a stand.
  useEffect(() => {
    try { if (localStorage.getItem("st:sound") === "1") { setSoundOn(true); soundRef.current = true; } } catch {}
    const unlock = () => soundRef.current && unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  function toggleSound() {
    const v = !soundOn;
    setSoundOn(v);
    soundRef.current = v;
    try { localStorage.setItem("st:sound", v ? "1" : "0"); } catch {}
    if (v) { unlockAudio(); beep(); }
  }

  function popUp(t: { text: string; sub: string; key: string; color: string }, quiet = false) {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), quiet ? 10000 : 20000);
    if (quiet) return; // deer sign isn't urgent: no buzz or beep
    vibrate();
    if (soundRef.current) beep();
  }

  /** Pop-up (+ vibration / sound) when someone ELSE reports a shot or a deer. */
  const announce = useCallback((all: Report[], deer: Sighting[], sg: Sign[], bl: Blind[], interval: number) => {
    const known = seen.current;
    seen.current = new Set([...all, ...deer, ...sg, ...bl].map((x) => x.id));
    if (!known) return; // first load: don't alert for old reports
    const freshBlind = bl.filter((x) => !known.has(x.id));
    const freshSign = sg.filter((x) => !known.has(x.id)).sort((a, b) => b.createdAt - a.createdAt);
    const fresh = all.filter((r) => !known.has(r.id));
    const freshDeer = deer.filter((d) => !known.has(d.id)).sort((a, b) => b.createdAt - a.createdAt);
    if (!fresh.length && freshDeer.length) {
      const d = freshDeer[0];
      const more = freshDeer.length - 1;
      popUp({
        key: d.id,
        color: DEER_STYLE[d.deer].color,
        text: `🦌 ${d.name} saw ${deerText(d.deer, d.count)}${d.heading == null ? "" : ` heading ${compassPoint(d.heading)}`}`,
        sub: `${ago(d.time)}${d.note ? ` · ${d.note}` : ""}${more ? ` · +${more} more new` : ""} · tap to view`,
      });
      return;
    }
    if (!fresh.length) {
      if (!freshDeer.length && !freshSign.length && freshBlind.length) {
        const x = freshBlind[0];
        popUp({
          key: x.id, color: BLIND_COLOR,
          text: `🟧 ${x.name} added a blind: ${x.title}`,
          sub: `${BLIND_STYLE[x.blind].label}${freshBlind.length > 1 ? ` · +${freshBlind.length - 1} more` : ""} · tap to view`,
        }, true);
      }
      if (!freshDeer.length && freshSign.length) {
        const x = freshSign[0];
        const more = freshSign.length - 1;
        popUp({
          key: x.id, color: SIGN_COLOR,
          text: `🍂 ${x.name} marked ${SIGN_STYLE[x.sign].label.toLowerCase()}`,
          sub: `${x.note ? `${x.note} · ` : ""}${more ? `+${more} more · ` : ""}tap to view`,
        }, true);
      }
      return;
    }
    const shots = groupShots(all, interval);
    const latest = fresh.sort((a, b) => b.createdAt - a.createdAt)[0];
    const shot = shots.find((s) => s.reports.some((r) => r.id === latest.id));
    if (!shot) return;
    const names = [...new Set(fresh.map((r) => r.name))].join(", ");
    const n = shot.reports.length;
    popUp({
      key: shot.key,
      color: colorFor(shot.index),
      text: n === 1 ? `🔊 ${names} heard a shot` : `🔊 ${names} also heard Shot #${shot.index + 1}`,
      sub: `Shot #${shot.index + 1} · ${n} report${n > 1 ? "s" : ""}${n >= 2 ? " · location estimated" : " · need 1 more to locate"} · tap to view`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login");
      const data = await res.json();
      setReports(data.reports);
      setSightings(data.sightings ?? []);
      setSigns(data.signs ?? []);
      setBlinds(data.blinds ?? []);
      setIntervalMin(data.intervalMin);
      announce(data.reports, data.sightings ?? [], data.signs ?? [], data.blinds ?? [], data.intervalMin);
      setHasDatabase(data.hasDatabase);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [announce]);

  // Refresh every 10 seconds while the page is on screen. Pauses when the phone
  // is locked or the app is in the background (saves database requests and battery),
  // and refreshes immediately when you come back.
  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Live "you are here" position.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setMe({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const shots: ShotView[] = useMemo(
    () => groupShots(reports, intervalMin).map((s) => ({ ...s, color: colorFor(s.index), fix: triangulate(s.reports) })),
    [reports, intervalMin],
  );
  const visible = shots.filter((s) => !hidden.has(s.key));

  // Deer sightings: "recent" = last 48 h, the same window a sighting can be entered for,
  // so anything someone reports is always shown by default.
  const recentCutoff = Math.floor(Date.now() / 60000) * 60000 - 48 * 3600_000;
  const rangedDeer = useMemo(
    () => sightings.filter((d) => deerRange === "all" || d.time >= recentCutoff).sort((a, b) => b.time - a.time),
    [sightings, deerRange, recentCutoff],
  );
  const mapShots = layers.shots ? visible : [];
  const mapDeer = layers.deer ? rangedDeer : [];

  const sortedSigns = useMemo(() => [...signs].sort((a, b) => b.time - a.time), [signs]);
  const mapSigns = layers.sign ? sortedSigns : [];
  const sortedBlinds = useMemo(() => [...blinds].sort((a, b) => a.title.localeCompare(b.title)), [blinds]);
  const mapBlinds = layers.blinds ? sortedBlinds : [];

  function focusOn(key: string) {
    if (key.startsWith("blind:")) {
      setLayer("blinds", true);
    } else if (key.startsWith("sign:")) {
      setLayer("sign", true);
    } else if (key.startsWith("sight:")) {
      setLayer("deer", true);
      const d = sightings.find((x) => x.id === key);
      if (d && d.time < recentCutoff) setDeerRange("all");
    } else {
      setLayer("shots", true);
      setHidden((h) => { const n = new Set(h); n.delete(key); return n; });
    }
    setFocus((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  }

  async function changeInterval(v: number) {
    setIntervalMin(v);
    await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalMin: v }),
    });
  }

  function toggle(key: string) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function remove(id: string) {
    if (!confirm("Delete this for everyone in the party? This can't be undone.")) return;
    await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  async function clearAll() {
    if (!confirm("Delete ALL shot reports for everyone? This can't be undone.")) return;
    await fetch("/api/reports", { method: "DELETE" });
    load();
  }

  async function clearBlinds() {
    if (!confirm("Delete ALL blinds for everyone? This can't be undone.")) return;
    await fetch("/api/blinds", { method: "DELETE" });
    load();
  }

  async function clearSigns() {
    if (!confirm("Delete ALL deer sign for everyone? This can't be undone.")) return;
    await fetch("/api/signs", { method: "DELETE" });
    load();
  }

  async function clearDeer() {
    if (!confirm("Delete ALL deer sightings for everyone? This can't be undone.")) return;
    await fetch("/api/sightings", { method: "DELETE" });
    load();
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>🦌<span className="hide-sm"> Shot Tracker</span></strong>
        <label className="interval">
          <span className="hide-sm">Same shot if within</span>
          <span className="show-sm">Group</span>
          <select value={intervalMin} onChange={(e) => changeInterval(Number(e.target.value))}>
            {[...new Set([...INTERVALS, intervalMin])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>{v < 1 ? `${v * 60} sec` : `${v} min`}</option>
            ))}
          </select>
        </label>
        <button className="btn small icon" onClick={toggleSound} aria-label={soundOn ? "Turn alert sound off" : "Turn alert sound on"}
          title={soundOn ? "Alert sound on" : "Alert sound off"}>
          {soundOn ? "🔔" : "🔕"}
        </button>
        <button className="btn small shots-btn" onClick={() => setPanelOpen((o) => !o)}>
          ☰ Layers
        </button>
      </header>

      {!hasDatabase && (
        <div className="banner">No database connected: reports are temporary. See README to connect Upstash.</div>
      )}
      {offline && <div className="banner">Can&apos;t reach the server. Retrying…</div>}

      <div className="main">
        <div className="map-wrap">
          {!picking && !ruler && <button className="blind-fab" onClick={() => openForm("blind")}>🟧 Add blind</button>}
          <ShotMap shots={mapShots} sightings={mapDeer} signs={mapSigns} blinds={mapBlinds} me={me} focus={focus}
            pickStart={pickMode === "heading" ? aimFrom
              : picking ? (picked ?? (me ? { lat: me.lat, lon: me.lon } : null)) : undefined}
            onDelete={remove}
            aim={pickMode === "heading" && aimFrom && center ? { from: aimFrom, to: center } : undefined}
            onCenter={(lat, lon) => setCenter({ lat, lon })}
            goto={goto}
            ruler={ruler ?? undefined}
            onRulerAdd={(lat, lon) => setRuler((r) => (r ? [...r, [lat, lon]] : r))} />
          {!picking && (
            <div className="map-tools">
              <button className={`tool ${locating ? "busy" : ""}`} onClick={locateMe} aria-label="Show my location" title="My location">
                {locating ? "…" : "📍"}
              </button>
              <button className={`tool ${ruler ? "active" : ""}`} onClick={() => setRuler((r) => (r ? null : []))}
                aria-pressed={!!ruler} aria-label="Measure distance" title="Ruler">📏</button>
            </div>
          )}
          {ruler && !picking && (
            <>
              {ruler.length === 0 && (
                <div className="pick-top">
                  <b>📏 Tap the map</b> to add points along the path you want to measure.
                </div>
              )}
              <div className="ruler-bar">
                <div className="ruler-total">
                  <span className="ruler-num">{formatDistance(rulerTotal)}</span>
                  <span className="muted">{ruler.length} point{ruler.length === 1 ? "" : "s"}</span>
                </div>
                <div className="row gap">
                  {ruler.length === 0 && me && (
                    <button className="btn" onClick={() => setRuler([[me.lat, me.lon]])}>Start from me</button>
                  )}
                  {ruler.length > 0 && <button className="btn" onClick={() => setRuler((r) => (r ? r.slice(0, -1) : r))}>↶ Undo</button>}
                  {ruler.length > 1 && <button className="btn" onClick={() => setRuler([])}>Clear</button>}
                  <button className="btn primary" onClick={() => setRuler(null)}>Done</button>
                </div>
              </div>
            </>
          )}
          {pickMode === "spot" && (
            <>
              <div className="crosshair" aria-hidden><span /></div>
              <div className="pick-top">
                <b>🎯 Drag the map</b> (or tap a spot) to put the crosshair on the {formKind === "deer" ? "deer" : formKind === "sign" ? "sign" : "blind"}.
                {center && me && (
                  <div className="pick-readout">
                    {formatDistance(distance(me.lat, me.lon, center.lat, center.lon))} {compassPoint(bearingTo(me.lat, me.lon, center.lat, center.lon))} of you
                    {" "}({Math.round(bearingTo(me.lat, me.lon, center.lat, center.lon))}°)
                  </div>
                )}
              </div>
              <div className="pick-bar">
                <button className="btn big-ghost" onClick={() => setPicking(false)}>Cancel</button>
                <button className="btn primary pick-ok" disabled={!center}
                  onClick={() => { if (center) setPicked({ ...center }); setPicking(false); }}>✓ Use this spot</button>
              </div>
            </>
          )}
          {pickMode === "heading" && (() => {
            const far = aimFrom && center ? distance(aimFrom.lat, aimFrom.lon, center.lat, center.lon) : 0;
            const hdg = aimFrom && center && far > 15 ? bearingTo(aimFrom.lat, aimFrom.lon, center.lat, center.lon) : null;
            return (
              <>
                <div className="crosshair" aria-hidden><span /></div>
                <div className="pick-top">
                  <b>🗺 Drag the map</b> (or tap) to pull a line from the deer the way it went.
                  <div className="pick-readout">{hdg == null ? "…" : `Heading ${compassPoint(hdg)} (${Math.round(hdg)}°)`}</div>
                </div>
                <div className="pick-bar">
                  <button className="btn big-ghost" onClick={() => setPicking(false)}>Cancel</button>
                  <button className="btn primary pick-ok" disabled={hdg == null}
                    onClick={() => { if (hdg != null) setPickedHeading(hdg); setPicking(false); }}>✓ Use this direction</button>
                </div>
              </>
            );
          })()}
        </div>
        <aside className={`panel ${panelOpen ? "open" : ""}`}>
          <ShotList
            me={me}
            layers={layers}
            onLayer={setLayer}
            onFocus={(key) => { focusOn(key); setPanelOpen(false); }}
            onDelete={remove}
            onClose={() => setPanelOpen(false)}
            shots={shots}
            hidden={hidden}
            onToggleShot={toggle}
            onShowAll={() => { setLayer("shots", true); setHidden(new Set()); }}
            onHideAll={() => setHidden(new Set(shots.map((s) => s.key)))}
            onOnlyLatest={() => { setLayer("shots", true); setHidden(new Set(shots.slice(0, -1).map((s) => s.key))); }}
            onClearShots={clearAll}
            sightings={rangedDeer}
            totalSightings={sightings.length}
            deerRange={deerRange}
            onDeerRange={setDeerRange}
            onClearDeer={clearDeer}
            signs={sortedSigns}
            onClearSigns={clearSigns}
            blinds={sortedBlinds}
            onAddBlind={() => { setPanelOpen(false); openForm("blind"); }}
            onClearBlinds={clearBlinds}
          />
        </aside>
      </div>

      {toast && !picking && (
        <button className="toast" style={{ borderLeftColor: toast.color }} onClick={() => {
          if (toast.key) focusOn(toast.key);
          setToast(null);
        }}>
          <strong>{toast.text}</strong>
          <span>{toast.sub}</span>
          <span className="toast-x" onClick={(e) => { e.stopPropagation(); setToast(null); }} aria-label="Dismiss">✕</span>
        </button>
      )}

      <div className="fabs" style={picking || ruler ? { display: "none" } : undefined}>
        <button className="report-fab" onClick={heardShot}>🔊 Heard a shot</button>
        <button className="deer-fab" onClick={() => openForm("deer")} aria-label="Report a deer sighting">🦌 Deer</button>
        <button className="sign-fab" onClick={() => openForm("sign")} aria-label="Mark deer sign">🍂 Sign</button>
      </div>

      {quick && (
        <QuickShot
          me={me}
          tappedAt={quick.tappedAt}
          compass={quick.compass}
          onClose={() => setQuick(null)}
          onManual={() => { const t = quick.tappedAt; setQuick(null); openForm("shot", t); }}
          onSaved={(id) => {
            seen.current?.add(id);
            setQuick(null);
            popUp({ key: "", color: "#2b8a3e", text: "✓ Shot registered", sub: "Everyone can see it now" }, true);
            load();
          }}
        />
      )}

      {formKind && (
        <ReportForm
          me={me}
          initialKind={formKind}
          startedAt={formStartedAt}
          onClose={() => { setFormKind(null); setPicking(false); }}
          picked={picked}
          pickedHeading={pickedHeading}
          onStartPick={(kind, origin) => {
            setRuler(null);
            if (kind === "heading") setAimFrom(origin ?? null);
            setPickMode(kind);
          }}
          hidden={picking}
          onSaved={(id) => {
            seen.current?.add(id);
            const what = formKind === "deer" ? "Deer sighting" : formKind === "sign" ? "Deer sign" : formKind === "blind" ? "Blind" : "Shot report";
            // Shots are grouped first, so there's no single spot to zoom to; others can be tapped to view.
            const zoomable = formKind !== "shot";
            popUp({ key: zoomable ? id : "", color: "#2b8a3e", text: `✓ ${what} saved`, sub: zoomable ? "Everyone can see it now · tap to view" : "Everyone can see it now" }, true);
            setFormKind(null);
            load();
          }}
        />
      )}
    </div>
  );
}
