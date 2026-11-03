"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupShots, triangulate, type Report, type Fix, type Shot } from "@/lib/geo";
import { colorFor } from "@/lib/colors";
import { beep, unlockAudio, vibrate } from "@/lib/alert";
import ReportForm from "./ReportForm";
import ShotList from "./ShotList";

const ShotMap = dynamic(() => import("./ShotMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

export type Me = { lat: number; lon: number; accuracy: number } | null;
export type ShotView = Shot & { color: string; fix: Fix | null };

const INTERVALS = [0.5, 1, 2, 3, 5, 10, 15, 30];

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [intervalMin, setIntervalMin] = useState(2);
  const [hasDatabase, setHasDatabase] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<Me>(null);
  const [formOpen, setFormOpen] = useState(false);
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

  /** Pop-up (+ vibration / sound) when someone ELSE reports a shot. */
  const announce = useCallback((all: Report[], interval: number) => {
    const known = seen.current;
    seen.current = new Set(all.map((r) => r.id));
    if (!known) return; // first load: don't alert for old reports
    const fresh = all.filter((r) => !known.has(r.id));
    if (!fresh.length) return;
    const shots = groupShots(all, interval);
    const latest = fresh.sort((a, b) => b.createdAt - a.createdAt)[0];
    const shot = shots.find((s) => s.reports.some((r) => r.id === latest.id));
    if (!shot) return;
    const names = [...new Set(fresh.map((r) => r.name))].join(", ");
    const n = shot.reports.length;
    setToast({
      key: shot.key,
      color: colorFor(shot.index),
      text: n === 1 ? `🔊 ${names} heard a shot` : `🔊 ${names} also heard Shot #${shot.index + 1}`,
      sub: `Shot #${shot.index + 1} · ${n} report${n > 1 ? "s" : ""}${n >= 2 ? " · location estimated" : " · need 1 more to locate"} · tap to view`,
    });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 20000);
    vibrate();
    if (soundRef.current) beep();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login");
      const data = await res.json();
      setReports(data.reports);
      setIntervalMin(data.intervalMin);
      announce(data.reports, data.intervalMin);
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
    if (!confirm("Delete this report?")) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    load();
  }

  async function clearAll() {
    if (!confirm("Delete ALL reports for everyone? This can't be undone.")) return;
    await fetch("/api/reports", { method: "DELETE" });
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
          Shots ({shots.length})
        </button>
      </header>

      {!hasDatabase && (
        <div className="banner">No database connected: reports are temporary. See README to connect Upstash.</div>
      )}
      {offline && <div className="banner">Can&apos;t reach the server. Retrying…</div>}

      <div className="main">
        <div className="map-wrap">
          <ShotMap shots={visible} me={me} focus={focus} />
        </div>
        <aside className={`panel ${panelOpen ? "open" : ""}`}>
          <ShotList
            shots={shots}
            hidden={hidden}
            me={me}
            onToggle={toggle}
            onShowAll={() => setHidden(new Set())}
            onHideAll={() => setHidden(new Set(shots.map((s) => s.key)))}
            onOnlyLatest={() => setHidden(new Set(shots.slice(0, -1).map((s) => s.key)))}
            onFocus={(key) => {
              setHidden((h) => { const n = new Set(h); n.delete(key); return n; });
              setFocus((f) => ({ key, n: (f?.n ?? 0) + 1 }));
              setPanelOpen(false);
            }}
            onDelete={remove}
            onClearAll={clearAll}
            onClose={() => setPanelOpen(false)}
          />
        </aside>
      </div>

      {toast && (
        <button className="toast" style={{ borderLeftColor: toast.color }} onClick={() => {
          setHidden((h) => { const n = new Set(h); n.delete(toast.key); return n; });
          setFocus((f) => ({ key: toast.key, n: (f?.n ?? 0) + 1 }));
          setToast(null);
        }}>
          <strong>{toast.text}</strong>
          <span>{toast.sub}</span>
          <span className="toast-x" onClick={(e) => { e.stopPropagation(); setToast(null); }} aria-label="Dismiss">✕</span>
        </button>
      )}

      <button className="report-fab" onClick={() => setFormOpen(true)}>🔊 I heard a shot</button>

      {formOpen && (
        <ReportForm
          me={me}
          onClose={() => setFormOpen(false)}
          onSaved={(id) => { seen.current?.add(id); setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}
