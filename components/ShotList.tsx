"use client";
import { useState } from "react";
import { bearingTo, compassPoint, distance, formatDistance, type Sighting } from "@/lib/geo";
import { DEER_STYLE } from "@/lib/colors";
import { ago } from "@/lib/time";
import type { Me, ShotView } from "./App";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

type Props = {
  shots: ShotView[];
  hidden: Set<string>;
  me: Me;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onOnlyLatest: () => void;
  onFocus: (key: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  sightings: Sighting[];
  totalSightings: number;
  showDeer: boolean;
  onShowDeer: (v: boolean) => void;
  deerRange: "today" | "all";
  onDeerRange: (v: "today" | "all") => void;
  onClearDeer: () => void;
};

export default function ShotList(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const newestFirst = [...p.shots].reverse();

  return (
    <div className="shotlist">
      <div className="row between">
        <h2>Shots</h2>
        <button className="btn small ghost close-panel" onClick={p.onClose}>✕</button>
      </div>
      <div className="row wrap gap">
        <button className="btn small" onClick={p.onShowAll}>Show all</button>
        <button className="btn small" onClick={p.onHideAll}>Hide all</button>
        <button className="btn small" onClick={p.onOnlyLatest}>Latest only</button>
      </div>

      {newestFirst.length === 0 && <p className="muted">No shots reported yet.</p>}

      {newestFirst.map((s, i) => {
        const prevDay = i > 0 ? fmtDay(newestFirst[i - 1].start) : null;
        const day = fmtDay(s.start);
        const fix = s.fix;
        return (
          <div key={s.key}>
            {day !== prevDay && <div className="day">{day}</div>}
            <div className={`shot ${p.hidden.has(s.key) ? "is-hidden" : ""}`}>
              <div className="row gap">
                <input type="checkbox" checked={!p.hidden.has(s.key)} onChange={() => p.onToggle(s.key)}
                  aria-label={`Show shot ${s.index + 1}`} />
                <span className="swatch" style={{ background: s.color }} />
                <button className="link grow" onClick={() => setOpen(open === s.key ? null : s.key)}>
                  <strong>Shot #{s.index + 1}</strong> · {fmtTime(s.start)}
                  <span className="muted"> · {s.reports.length} report{s.reports.length > 1 ? "s" : ""}</span>
                </button>
                <button className="btn small" onClick={() => p.onFocus(s.key)}>Zoom</button>
              </div>
              <div className="fixline">
                {fix ? (
                  <>
                    Estimate ±{formatDistance(fix.radius)}
                    {p.me && (
                      <> · <strong>{formatDistance(distance(p.me.lat, p.me.lon, fix.lat, fix.lon))}{" "}
                        {compassPoint(bearingTo(p.me.lat, p.me.lon, fix.lat, fix.lon))}</strong> of you
                        ({Math.round(bearingTo(p.me.lat, p.me.lon, fix.lat, fix.lon))}°)</>
                    )}
                    {fix.behind.length > 0 && (
                      <div className="warn">⚠ Doesn&apos;t fit {fix.behind.join(", ")}&apos;s bearing; check it.</div>
                    )}
                  </>
                ) : s.reports.length < 2 ? (
                  <span className="muted">Need 2+ reports to locate</span>
                ) : (
                  <span className="warn">Lines don&apos;t cross; check the bearings</span>
                )}
              </div>
              {open === s.key && (
                <ul className="reports">
                  {s.reports.map((r) => (
                    <li key={r.id} className="row gap">
                      <span className="grow">
                        <strong>{r.name}</strong> · {fmtTime(r.shotTime)} · {Math.round(r.bearingTrue)}° true
                        {r.bearingRef === "magnetic" && (
                          <span className="muted"> ({Math.round(r.bearingInput)}° mag)</span>
                        )}
                        {r.accuracy != null && <span className="muted"> · GPS ±{Math.round(r.accuracy)} m</span>}
                      </span>
                      <button className="btn small danger" onClick={() => p.onDelete(r.id)}>Delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}

      {p.shots.length > 0 && (
        <button className="btn small danger clear-all" onClick={p.onClearAll}>Clear all shot reports</button>
      )}

      <div className="row between section-title">
        <h2>🦌 Deer sightings</h2>
        <label className="row gap" style={{ flexDirection: "row", fontWeight: 500 }}>
          <input type="checkbox" checked={p.showDeer} onChange={(e) => p.onShowDeer(e.target.checked)} style={{ width: 20, height: 20 }} />
          On map
        </label>
      </div>
      <div className="tabs small">
        <button type="button" className={p.deerRange === "today" ? "on" : ""} onClick={() => p.onDeerRange("today")}>Today</button>
        <button type="button" className={p.deerRange === "all" ? "on" : ""} onClick={() => p.onDeerRange("all")}>All ({p.totalSightings})</button>
      </div>
      {p.sightings.length === 0 && <p className="muted">No deer sightings {p.deerRange === "today" ? "today" : "yet"}.</p>}
      {p.sightings.map((d) => {
        const st = DEER_STYLE[d.deer];
        return (
          <div key={d.id} className="sighting">
            <div className="row gap">
              <span className="deer-dot" style={{ background: st.color }}>{st.letter}</span>
              <span className="grow">
                <strong>{d.count > 1 ? `${d.count} × ` : ""}{st.label}</strong>
                {d.heading == null ? " · not moving" : ` · heading ${compassPoint(d.heading)} (${Math.round(d.heading)}°)`}
                <br />
                <span className="muted">{d.name} · {fmtTime(d.time)} ({ago(d.time)})</span>
                {p.me && <span className="muted"> · {formatDistance(distance(p.me.lat, p.me.lon, d.lat, d.lon))} {compassPoint(bearingTo(p.me.lat, p.me.lon, d.lat, d.lon))} of you</span>}
                {d.note && <><br />“{d.note}”</>}
              </span>
            </div>
            <div className="row gap" style={{ justifyContent: "flex-end", marginTop: 6 }}>
              <button className="btn small" onClick={() => p.onFocus(d.id)}>Zoom</button>
              <button className="btn small danger" onClick={() => p.onDelete(d.id)}>Delete</button>
            </div>
          </div>
        );
      })}
      {p.totalSightings > 0 && (
        <button className="btn small danger clear-all" onClick={p.onClearDeer}>Clear all deer sightings</button>
      )}
    </div>
  );
}
