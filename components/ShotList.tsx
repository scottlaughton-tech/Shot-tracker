"use client";
// The "Layers" panel.
// Top (always visible): one-tap layer switches, then tabs for the detailed lists.
// Below: one list at a time. Tapping a row zooms to it; deleting needs "Edit" first.
import { useEffect, useState } from "react";
import { bearingTo, compassPoint, distance, formatDistance, type Blind, type Sighting, type Sign } from "@/lib/geo";
import { BLIND_COLOR, BLIND_STYLE, DEER_STYLE, SIGN_COLOR, SIGN_STYLE } from "@/lib/colors";
import { ago, when } from "@/lib/time";
import type { Me, ShotView } from "./App";

export type LayerKey = "shots" | "deer" | "sign" | "blinds";
export type Layers = Record<LayerKey, boolean>;

const LAYERS: { key: LayerKey; icon: string; label: string; color: string }[] = [
  { key: "shots", icon: "🔊", label: "Shots", color: "#d9480f" },
  { key: "deer", icon: "🦌", label: "Deer", color: "#6b3e1f" },
  { key: "sign", icon: "🍂", label: "Sign", color: SIGN_COLOR },
  { key: "blinds", icon: "🟧", label: "Blinds", color: BLIND_COLOR },
];

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

type Props = {
  me: Me;
  layers: Layers;
  onLayer: (k: LayerKey, on: boolean) => void;
  onFocus: (key: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  // shots
  shots: ShotView[];
  hidden: Set<string>;
  onToggleShot: (key: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onOnlyLatest: () => void;
  onClearShots: () => void;
  // deer
  sightings: Sighting[];
  totalSightings: number;
  deerRange: "recent" | "all";
  onDeerRange: (v: "recent" | "all") => void;
  onClearDeer: () => void;
  // sign
  signs: Sign[];
  onClearSigns: () => void;
  // blinds
  blinds: Blind[];
  onAddBlind: () => void;
  onClearBlinds: () => void;
};

function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && allowed.includes(s)) setV(s);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (n: T) => { setV(n); try { localStorage.setItem(key, n); } catch {} };
  return [v, set] as const;
}

export default function ShotList(p: Props) {
  const [tab, setTab] = useStored<LayerKey>("st:tab", "shots", ["shots", "deer", "sign", "blinds"]);
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const counts: Record<LayerKey, number> = {
    shots: p.shots.length, deer: p.sightings.length, sign: p.signs.length, blinds: p.blinds.length,
  };
  const away = (lat: number, lon: number) =>
    p.me ? `${formatDistance(distance(p.me.lat, p.me.lon, lat, lon))} ${compassPoint(bearingTo(p.me.lat, p.me.lon, lat, lon))}` : null;
  const active = LAYERS.find((l) => l.key === tab)!;

  return (
    <div className="lp">
      {/* ---------- Fixed header: layer switches + tabs ---------- */}
      <div className="lp-head">
        <div className="row between">
          <h2>Map layers</h2>
          <button className="lp-close" onClick={p.onClose} aria-label="Close">✕</button>
        </div>

        <div className="layer-grid" role="group" aria-label="Show or hide on map">
          {LAYERS.map((l) => {
            const on = p.layers[l.key];
            return (
              <button key={l.key} className={`layer-btn ${on ? "on" : ""}`} style={{ "--c": l.color } as React.CSSProperties}
                aria-pressed={on} onClick={() => p.onLayer(l.key, !on)}>
                <span className="layer-icon">{l.icon}</span>
                <span className="layer-label">{l.label}</span>
                <span className="layer-state">{on ? `On · ${counts[l.key]}` : "Off"}</span>
              </button>
            );
          })}
        </div>

        <div className="lp-tabs">
          <div className="tabs grow" role="tablist">
            {LAYERS.map((l) => (
              <button key={l.key} role="tab" aria-selected={tab === l.key} className={tab === l.key ? "on" : ""}
                onClick={() => { setTab(l.key); setOpen(null); }}>
                {l.label}
              </button>
            ))}
          </div>
          <button className={`btn small edit-btn ${edit ? "editing" : ""}`} onClick={() => setEdit((e) => !e)}>
            {edit ? "Done" : "Edit"}
          </button>
        </div>
        {edit && <p className="edit-hint">Edit mode: 🗑 deletes for <b>everyone</b> in the party.</p>}
      </div>

      {/* ---------- Detailed list for the selected tab ---------- */}
      <div className="lp-body">
        {!p.layers[tab] && (
          <div className="off-note">
            {active.label} are hidden on the map.
            <button className="btn small" onClick={() => p.onLayer(tab, true)}>Show</button>
          </div>
        )}

        {tab === "shots" && (
          <>
            {p.shots.length > 0 && (
              <div className="row gap wrap">
                <button className="btn small" onClick={p.onShowAll}>Show all</button>
                <button className="btn small" onClick={p.onOnlyLatest}>Latest only</button>
                <button className="btn small" onClick={p.onHideAll}>Hide all</button>
              </div>
            )}
            {p.shots.length === 0 && <p className="muted empty">No shots reported yet.</p>}
            {[...p.shots].reverse().map((s, i, arr) => {
              const day = fmtDay(s.start);
              const showDay = i === 0 || fmtDay(arr[i - 1].start) !== day;
              const visible = !p.hidden.has(s.key);
              const fix = s.fix;
              return (
                <div key={s.key}>
                  {showDay && <div className="day">{day}</div>}
                  <div className={`item ${visible ? "" : "dim"}`}>
                    <button className="vis" aria-pressed={visible} aria-label={visible ? `Hide shot ${s.index + 1}` : `Show shot ${s.index + 1}`}
                      onClick={() => p.onToggleShot(s.key)}>
                      <span className="vis-dot" style={{ borderColor: s.color, background: visible ? s.color : "transparent" }} />
                    </button>
                    <button className="item-main" onClick={() => p.onFocus(s.key)}>
                      <strong>Shot #{s.index + 1} · {fmtTime(s.start)}</strong>
                      <span className="sub">
                        {s.reports.length} report{s.reports.length > 1 ? "s" : ""}
                        {fix ? <> · ±{formatDistance(fix.radius)}{p.me && <> · <b>{away(fix.lat, fix.lon)}</b> of you</>}</>
                          : s.reports.length < 2 ? " · need 2+ to locate" : " · lines don't cross"}
                      </span>
                      {fix && fix.behind.length > 0 && <span className="warn">Not used (doesn&apos;t line up): {fix.behind.join(", ")}</span>}
                    </button>
                    <button className="chev" aria-expanded={open === s.key} aria-label="Show reports"
                      onClick={() => setOpen(open === s.key ? null : s.key)}>{open === s.key ? "▴" : "▾"}</button>
                  </div>
                  {open === s.key && (
                    <ul className="subitems">
                      {s.reports.map((r) => (
                        <li key={r.id}>
                          <span className="grow">
                            <b>{r.name}</b> · {fmtTime(r.shotTime)} · {Math.round(r.bearingTrue)}° true
                            {fix?.excluded.includes(r.id) && <span className="muted"> · not used</span>}
                            {r.bearingRef === "magnetic" && <span className="muted"> ({Math.round(r.bearingInput)}° mag)</span>}
                          </span>
                          {edit && <button className="trash" onClick={() => p.onDelete(r.id)} aria-label={`Delete ${r.name}'s report`}>🗑</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {edit && p.shots.length > 0 && <Danger label="Clear all shot reports" onClick={p.onClearShots} />}
          </>
        )}

        {tab === "deer" && (
          <>
            <div className="tabs small">
              <button className={p.deerRange === "recent" ? "on" : ""} onClick={() => p.onDeerRange("recent")}>Last 48 h</button>
              <button className={p.deerRange === "all" ? "on" : ""} onClick={() => p.onDeerRange("all")}>All days ({p.totalSightings})</button>
            </div>
            {p.sightings.length === 0 && <p className="muted empty">No deer sightings {p.deerRange === "recent" ? "in the last 48 hours" : "yet"}.</p>}
            {p.sightings.map((d) => {
              const st = DEER_STYLE[d.deer];
              return (
                <Row key={d.id} badge={st.letter} color={st.color} edit={edit}
                  onOpen={() => p.onFocus(d.id)} onDelete={() => p.onDelete(d.id)}
                  title={`${d.count > 1 ? `${d.count} × ` : ""}${st.label}${d.heading == null ? " · not moving" : ` · heading ${compassPoint(d.heading)}`}`}
                  sub={`${d.name} · ${when(d.time)} (${ago(d.time)})${away(d.lat, d.lon) ? ` · ${away(d.lat, d.lon)}` : ""}`}
                  note={d.note} />
              );
            })}
            {edit && p.totalSightings > 0 && <Danger label="Clear all deer sightings" onClick={p.onClearDeer} />}
          </>
        )}

        {tab === "sign" && (
          <>
            {p.signs.length === 0 && <p className="muted empty">No deer sign marked yet.</p>}
            {p.signs.map((x) => (
              <Row key={x.id} badge={SIGN_STYLE[x.sign].short} color={SIGN_COLOR} edit={edit} square
                onOpen={() => p.onFocus(x.id)} onDelete={() => p.onDelete(x.id)}
                title={SIGN_STYLE[x.sign].label}
                sub={`${x.name} · ${fmtDay(x.time)}${away(x.lat, x.lon) ? ` · ${away(x.lat, x.lon)}` : ""}`}
                note={x.note} />
            ))}
            {edit && p.signs.length > 0 && <Danger label="Clear all deer sign" onClick={p.onClearSigns} />}
          </>
        )}

        {tab === "blinds" && (
          <>
            <button className="btn add-blind" onClick={p.onAddBlind}>＋ Add a blind</button>
            {p.blinds.length === 0 && <p className="muted empty">No blinds added yet.</p>}
            {p.blinds.map((x) => (
              <Row key={x.id} badge="▲" color={BLIND_COLOR} edit={edit} square
                onOpen={() => p.onFocus(x.id)} onDelete={() => p.onDelete(x.id)}
                title={`${x.title} · ${BLIND_STYLE[x.blind].label}`}
                sub={`Added by ${x.name}${away(x.lat, x.lon) ? ` · ${away(x.lat, x.lon)}` : ""}`}
                note={x.note} />
            ))}
            {edit && p.blinds.length > 0 && <Danger label="Clear all blinds" onClick={p.onClearBlinds} />}
          </>
        )}
      </div>
    </div>
  );
}

function Row(r: {
  badge: string; color: string; square?: boolean; title: string; sub: string; note?: string;
  edit: boolean; onOpen: () => void; onDelete: () => void;
}) {
  return (
    <div className="item">
      <span className="badge" style={{ background: r.color, borderRadius: r.square ? 6 : 999 }}>{r.badge}</span>
      <button className="item-main" onClick={r.onOpen}>
        <strong>{r.title}</strong>
        <span className="sub">{r.sub}</span>
        {r.note && <span className="note">“{r.note}”</span>}
      </button>
      {r.edit ? (
        <button className="trash" onClick={r.onDelete} aria-label="Delete">🗑</button>
      ) : (
        <span className="go" aria-hidden>›</span>
      )}
    </div>
  );
}

function Danger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="danger-zone">
      <button className="btn danger" onClick={onClick}>{label}</button>
      <span className="muted">Deletes for everyone. Can&apos;t be undone.</span>
    </div>
  );
}
