"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { groupShots, triangulate, type Report, type Fix, type Shot } from "@/lib/geo";
import { colorFor } from "@/lib/colors";
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login");
      const data = await res.json();
      setReports(data.reports);
      setIntervalMin(data.intervalMin);
      setHasDatabase(data.hasDatabase);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  // Refresh every 5 seconds so everyone sees new reports.
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
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
        <strong>🦌 Shot Tracker</strong>
        <label className="interval">
          <span className="hide-sm">Same shot if within</span>
          <span className="show-sm">Group</span>
          <select value={intervalMin} onChange={(e) => changeInterval(Number(e.target.value))}>
            {[...new Set([...INTERVALS, intervalMin])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>{v < 1 ? `${v * 60} sec` : `${v} min`}</option>
            ))}
          </select>
        </label>
        <button className="btn small" onClick={() => setPanelOpen((o) => !o)}>
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

      <button className="report-fab" onClick={() => setFormOpen(true)}>🔊 I heard a shot</button>

      {formOpen && (
        <ReportForm
          me={me}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}
