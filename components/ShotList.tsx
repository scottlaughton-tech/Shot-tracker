"use client";
import { useState } from "react";
import { bearingTo, compassPoint, distance, formatDistance } from "@/lib/geo";
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
        <button className="btn small danger clear-all" onClick={p.onClearAll}>Clear all reports</button>
      )}
    </div>
  );
}
