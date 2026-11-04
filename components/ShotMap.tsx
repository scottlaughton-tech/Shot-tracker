"use client";
import type { Trail } from "@/lib/store";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle, CircleMarker, LayersControl, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents,
} from "react-leaflet";
import { bearingTo, compassPoint, destination, distance, ellipsePolygon, formatDistance, type Sighting, type Sign, type Blind } from "@/lib/geo";
import { BLIND_STYLE, DEER_STYLE, SIGN_STYLE } from "@/lib/colors";
import type { Me, ShotView } from "./App";

const DEFAULT_CENTER: [number, number] = [45.0985, -78.3197];
import { when } from "@/lib/time";
import { useHeading } from "@/lib/compass";
import { declinationAt } from "@/lib/declination";
const fmtTime = when; // date + time, e.g. "Yesterday 11:30 AM"

function estimateIcon(color: string, label: string) {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="est-icon" style="--c:${color}"><span>${label}</span></div>`,
  });
}

/** Zooms the map to fit everything once on first data, and when a shot is "Zoomed". */
function FitBounds({ shots, sightings, signs, blinds, me, focus }: {
  shots: ShotView[]; sightings: Sighting[]; signs: Sign[]; blinds: Blind[]; me: Me; focus: { key: string; n: number } | null;
}) {
  const map = useMap();
  const didInitial = useRef(false);
  const lastFocus = useRef(0);

  useEffect(() => {
    const pts = (list: ShotView[]) => {
      const out: [number, number][] = [];
      list.forEach((s) => {
        s.reports.forEach((r) => out.push([r.lat, r.lon]));
        if (s.fix) out.push([s.fix.lat, s.fix.lon]);
      });
      return out;
    };
    if (focus && focus.n !== lastFocus.current) {
      lastFocus.current = focus.n;
      const d = sightings.find((x) => x.id === focus.key) ?? signs.find((x) => x.id === focus.key) ?? blinds.find((x) => x.id === focus.key);
      if (d) {
        map.setView([d.lat, d.lon], Math.max(map.getZoom(), 15));
        return;
      }
      const s = shots.find((x) => x.key === focus.key);
      if (s) {
        const p = pts([s]);
        if (!s.fix) s.reports.forEach((r) => p.push(destination(r.lat, r.lon, r.bearingTrue, 1500)));
        map.fitBounds(L.latLngBounds(p), { padding: [40, 40], maxZoom: 16 });
      }
      return;
    }
    if (!didInitial.current) {
      const p = pts(shots);
      sightings.forEach((d) => p.push([d.lat, d.lon]));
      signs.forEach((d) => p.push([d.lat, d.lon]));
      blinds.forEach((d) => p.push([d.lat, d.lon]));
      if (p.length) {
        didInitial.current = true;
        map.fitBounds(L.latLngBounds(p), { padding: [40, 40], maxZoom: 15 });
      } else if (me) {
        didInitial.current = true;
        map.setView([me.lat, me.lon], 14);
      }
    }
  }, [shots, sightings, signs, blinds, me, focus, map]);
  return null;
}

/** Crosshair mode: the map centre is the chosen spot. Dragging moves it; a tap slides that spot to the centre. */
function PickMode({ start, onCenter }: { start: { lat: number; lon: number } | null; onCenter: (lat: number, lon: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (start) map.setView([start.lat, start.lon], Math.max(map.getZoom(), 15));
    else if (map.getZoom() < 15) map.setZoom(15);
    const c = map.getCenter();
    onCenter(c.lat, c.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useMapEvents({
    move: () => { const c = map.getCenter(); onCenter(c.lat, c.lng); },
    click: (e) => map.panTo(e.latlng),
  });
  return null;
}

/** Flies to a spot when `goto.n` changes (used by the "My location" button). */
function GoTo({ goto }: { goto: { lat: number; lon: number; n: number; zoom?: number } | null }) {
  const map = useMap();
  const last = useRef(0);
  useEffect(() => {
    if (!goto || goto.n === last.current) return;
    last.current = goto.n;
    map.flyTo([goto.lat, goto.lon], goto.zoom ?? Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [goto, map]);
  return null;
}

/** Ruler: every tap on the map adds a point. */
function RulerMode({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onAdd(e.latlng.lat, e.latlng.lng) });
  return null;
}

/**
 * While the ruler or the crosshair is active, tapping a marker should feed that tool
 * (add a ruler point exactly on it / slide it under the crosshair) instead of opening a popup.
 */
const TapCtx = createContext<((lat: number, lon: number) => void) | null>(null);
/** A popup that is switched off while a tool is using taps. */
function Pop({ children }: { children: React.ReactNode }) {
  return useContext(TapCtx) ? null : <Popup>{children}</Popup>;
}
const tapHandlers = (tap: ((lat: number, lon: number) => void) | null, lat: number, lon: number) =>
  tap ? { click: () => tap(lat, lon) } : {};

/** "🗑 Delete" button shown at the bottom of a popup. */
function DelBtn({ id, onDelete, label = "Delete" }: { id: string; onDelete?: (id: string) => void; label?: string }) {
  const map = useMap();
  if (!onDelete) return null;
  return (
    <div className="popup-actions">
      <button className="popup-del" onClick={() => { map.closePopup(); onDelete(id); }}>🗑 {label}</button>
    </div>
  );
}

export default function ShotMap({ shots, sightings, signs, blinds, me, focus, pickStart, onCenter, goto, ruler, onRulerAdd, aim, onDelete, liveBearing, trails }: {
  shots: ShotView[]; sightings: Sighting[]; signs: Sign[]; blinds: Blind[]; me: Me; focus: { key: string; n: number } | null;
  /** imported GPX trails, drawn under everything else */
  trails?: Trail[];
  /** set (even to null) while the crosshair is open */
  pickStart?: { lat: number; lon: number } | null;
  onCenter?: (lat: number, lon: number) => void;
  goto?: { lat: number; lon: number; n: number; zoom?: number } | null;
  /** quick shot: draw a live line from you in the direction the phone points */
  liveBearing?: boolean;
  /** ruler points; undefined = ruler off */
  ruler?: [number, number][];
  onRulerAdd?: (lat: number, lon: number) => void;
  /** "On map" direction: line from the deer to the crosshair */
  aim?: { from: { lat: number; lon: number }; to: { lat: number; lon: number } };
  onDelete?: (id: string) => void;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const tap = ruler && onRulerAdd ? onRulerAdd
    : pickStart !== undefined ? (lat: number, lon: number) => map?.panTo([lat, lon]) : null;
  const icons = useMemo(() => new Map(shots.map((s) => [s.key, estimateIcon(s.color, String(s.index + 1))])), [shots]);

  return (
    <TapCtx.Provider value={tap}>
    <MapContainer center={DEFAULT_CENTER} zoom={13} className="map" zoomControl={false} ref={setMap}>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Topo (OpenTopoMap)">
          <TileLayer
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            maxZoom={17}
            attribution='Map: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite (Esri)">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
            attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Streets (OpenStreetMap)">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      {trails?.map((t) => (
        <Fragment key={t.id}>
          {/* dark edge so a yellow trail shows on the light topo map, then the trail colour */}
          <Polyline positions={t.lines} interactive={false} pathOptions={{ color: "#3d2e00", weight: 6, opacity: 0.55, lineJoin: "round" }} />
          <Polyline positions={t.lines} interactive={false} pathOptions={{ color: t.color, weight: 3, opacity: 0.95, lineJoin: "round" }} />
        </Fragment>
      ))}

      {pickStart !== undefined && onCenter && <PickMode start={pickStart} onCenter={onCenter} />}
      <GoTo goto={goto ?? null} />
      {liveBearing && me && <LiveBearing me={me} />}
      {ruler && onRulerAdd && <RulerMode onAdd={onRulerAdd} />}
      {ruler && ruler.length > 0 && <RulerLine pts={ruler} />}
      {aim && (
        <>
          <Polyline positions={[[aim.from.lat, aim.from.lon], [aim.to.lat, aim.to.lon]]} interactive={false}
            pathOptions={{ color: "#fff", weight: 7, opacity: 0.8 }} />
          <Polyline positions={[[aim.from.lat, aim.from.lon], [aim.to.lat, aim.to.lon]]} interactive={false}
            pathOptions={{ color: "#6b3e1f", weight: 4, dashArray: "10 6" }} />
          <CircleMarker center={[aim.from.lat, aim.from.lon]} radius={9} interactive={false}
            pathOptions={{ color: "#fff", weight: 3, fillColor: "#6b3e1f", fillOpacity: 1 }}>
            <Tooltip permanent direction="left" offset={[-10, 0]}>Deer</Tooltip>
          </CircleMarker>
        </>
      )}
      <FitBounds shots={shots} sightings={sightings} signs={signs} blinds={blinds} me={me} focus={focus} />

      {blinds.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={blindIcon} zIndexOffset={-100} eventHandlers={tapHandlers(tap, x.lat, x.lon)}>
          <Tooltip permanent direction="right" offset={[10, 0]} className="blind-label">{x.name}</Tooltip>
          <Pop>
            <b>{x.title}</b> · {BLIND_STYLE[x.blind].label}<br />
            Added by {x.name}
            {x.note && <><br />“{x.note}”</>}
            <br />{x.lat.toFixed(5)}, {x.lon.toFixed(5)}
            {me && <><br />{formatDistance(distance(me.lat, me.lon, x.lat, x.lon))} {compassPoint(bearingTo(me.lat, me.lon, x.lat, x.lon))} of you</>}
            <DelBtn id={x.id} onDelete={onDelete} label="Delete blind" />
          </Pop>
        </Marker>
      ))}

      {signs.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={signIcon(x)} eventHandlers={tapHandlers(tap, x.lat, x.lon)}>
          <Pop>
            <b>{SIGN_STYLE[x.sign].label}</b><br />
            Marked by {x.name}, {fmtTime(x.time)}
            {x.note && <><br />“{x.note}”</>}
            {me && <><br />{formatDistance(distance(me.lat, me.lon, x.lat, x.lon))} {compassPoint(bearingTo(me.lat, me.lon, x.lat, x.lon))} of you</>}
            <DelBtn id={x.id} onDelete={onDelete} />
          </Pop>
        </Marker>
      ))}

      {sightings.map((d) => <SightingLayer key={d.id} d={d} me={me} onDelete={onDelete} />)}

      {shots.map((s) => (
        <ShotLayer key={s.key} shot={s} me={me} icon={icons.get(s.key)!} onDelete={onDelete} />
      ))}

      {me && (
        <>
          <Circle center={[me.lat, me.lon]} radius={me.accuracy} pathOptions={{ color: "#1a73e8", weight: 1, fillOpacity: 0.1 }} />
          <MeMarker me={me} eventHandlers={tapHandlers(tap, me.lat, me.lon)} />
        </>
      )}
    </MapContainer>
    </TapCtx.Provider>
  );
}

function ShotLayer({ shot, me, icon, onDelete }: { shot: ShotView; me: Me; icon: L.DivIcon; onDelete?: (id: string) => void }) {
  const tap = useContext(TapCtx);
  const fix = shot.fix;
  return (
    <>
      {shot.reports.map((r) => {
        const left = !!fix && fix.excluded.includes(r.id); // doesn't fit the others: not used
        // Lines used in an estimate stop level with it; others get a fixed length.
        let len = 4000;
        if (fix && !left) {
          const d = distance(r.lat, r.lon, fix.lat, fix.lon);
          const off = ((bearingTo(r.lat, r.lon, fix.lat, fix.lon) - r.bearingTrue) * Math.PI) / 180;
          len = Math.max(d * Math.cos(off), 50);
        }
        const end = destination(r.lat, r.lon, r.bearingTrue, len);
        const color = left ? "#8a8a8a" : shot.color;
        return (
          <Fragment key={r.id}>
            <Polyline positions={[[r.lat, r.lon], end]} interactive={false}
              pathOptions={{ color: "#fff", weight: 4, opacity: left ? 0.35 : 0.55 }} />
            <Polyline positions={[[r.lat, r.lon], end]}
              pathOptions={{ color, weight: 2, dashArray: left ? "3 7" : "8 6", opacity: left ? 0.8 : 1 }}>
              <Tooltip sticky>{r.name} · {Math.round(r.bearingTrue)}°{left ? " · not used" : ""}</Tooltip>
            </Polyline>
            <CircleMarker center={[r.lat, r.lon]} radius={6} bubblingMouseEvents={!tap} eventHandlers={tapHandlers(tap, r.lat, r.lon)}
              pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }}>
              <Tooltip permanent direction="right" offset={[8, 0]} className="name-label">{r.name}</Tooltip>
              <Pop>
                <b>{r.name}</b> · Shot #{shot.index + 1}<br />
                Heard {fmtTime(r.shotTime)}<br />
                Bearing {Math.round(r.bearingTrue)}° true
                {r.bearingRef === "magnetic" && <> ({Math.round(r.bearingInput)}° magnetic)</>}<br />
                {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                {left && <><br /><span style={{ color: "#666" }}>Grey: doesn&apos;t line up with the other reports, so it&apos;s not used in the estimate.</span></>}
                <DelBtn id={r.id} onDelete={onDelete} label={`Delete ${r.name}'s report`} />
              </Pop>
            </CircleMarker>
          </Fragment>
        );
      })}
      {fix && (
        <>
          <Polygon positions={ellipsePolygon(fix)}
            pathOptions={{ color: shot.color, weight: 2, dashArray: "6 4", fillColor: shot.color, fillOpacity: 0.15 }} />
          <Marker position={[fix.lat, fix.lon]} icon={icon} eventHandlers={tapHandlers(tap, fix.lat, fix.lon)}>
            <Pop>
              <b>Shot #{shot.index + 1} estimate</b><br />
              {fmtTime(shot.start)} · {shot.reports.length} reports<br />
              {fix.lat.toFixed(5)}° N, {Math.abs(fix.lon).toFixed(5)}° {fix.lon < 0 ? "W" : "E"}<br />
              Uncertainty ~±{formatDistance(fix.radius)} (95% area shown)
              {me && (
                <>
                  <br />
                  <b>{formatDistance(distance(me.lat, me.lon, fix.lat, fix.lon))} {compassPoint(bearingTo(me.lat, me.lon, fix.lat, fix.lon))}</b> of you
                  ({Math.round(bearingTo(me.lat, me.lon, fix.lat, fix.lon))}° true)
                </>
              )}
            </Pop>
          </Marker>
        </>
      )}
    </>
  );
}

function deerIcon(d: Sighting) {
  const st = DEER_STYLE[d.deer];
  const label = d.count > 1 ? `${st.letter}×${d.count}` : st.letter;
  const w = 26 + (label.length - 1) * 9;
  // Small arrowhead sticking out of the marker's edge in the direction of travel.
  // It's part of the icon, so it stays the same size at every zoom level.
  const r = w / 2 + 1; // distance from centre to the marker edge
  const arrow = d.heading == null ? "" :
    `<div class="deer-dir" style="transform:rotate(${Math.round(d.heading)}deg)"><span style="--c:${st.color};top:${-r - 9}px"></span></div>`;
  return L.divIcon({
    className: "",
    iconSize: [w, 26],
    iconAnchor: [w / 2, 13],
    html: `<div class="deer-wrap" style="width:${w}px">${arrow}<div class="deer-icon" style="--c:${st.color};width:${w}px">${label}</div></div>`,
  });
}

/** Deer marker with a small direction arrowhead. Older sightings fade. */
function SightingLayer({ d, me, onDelete }: { d: Sighting; me: Me; onDelete?: (id: string) => void }) {
  const tap = useContext(TapCtx);
  const st = DEER_STYLE[d.deer];
  const ageH = (Date.now() - d.time) / 3600_000;
  const opacity = ageH < 1 ? 1 : ageH < 3 ? 0.75 : 0.5;
  const icon = useMemo(() => deerIcon(d), [d]);
  return (
    <>
      <Marker position={[d.lat, d.lon]} icon={icon} opacity={opacity} eventHandlers={tapHandlers(tap, d.lat, d.lon)}>
        <Pop>
          <b>{d.count > 1 ? `${d.count} × ` : ""}{st.label}</b> seen by {d.name}<br />
          {fmtTime(d.time)}<br />
          {d.heading == null ? "Not moving" : <>Heading {compassPoint(d.heading)} ({Math.round(d.heading)}° true)</>}
          {d.note && <><br />“{d.note}”</>}
          {d.observer && <><br /><span style={{ color: "#666" }}>Spotted from {formatDistance(distance(d.observer.lat, d.observer.lon, d.lat, d.lon))} away</span></>}
          {me && (
            <>
              <br />
              {formatDistance(distance(me.lat, me.lon, d.lat, d.lon))} {compassPoint(bearingTo(me.lat, me.lon, d.lat, d.lon))} of you
            </>
          )}
          <DelBtn id={d.id} onDelete={onDelete} />
        </Pop>
      </Marker>
    </>
  );
}

const signIcons = new Map<string, L.DivIcon>();
function signIcon(x: Sign) {
  let icon = signIcons.get(x.sign);
  if (!icon) {
    icon = L.divIcon({
      className: "", iconSize: [24, 24], iconAnchor: [12, 12],
      html: `<div class="sign-icon"><span>${SIGN_STYLE[x.sign].short}</span></div>`,
    });
    signIcons.set(x.sign, icon);
  }
  return icon;
}

const blindIcon = L.divIcon({
  className: "", iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<div class="blind-icon">▲</div>`,
});

/** The measured line: yellow-on-black so it shows on topo and satellite, with running totals at each point. */
function RulerLine({ pts }: { pts: [number, number][] }) {
  let total = 0;
  const labels = pts.map((p, i) => {
    if (i > 0) total += distance(pts[i - 1][0], pts[i - 1][1], p[0], p[1]);
    return i === 0 ? "Start" : formatDistance(total);
  });
  return (
    <>
      {pts.length > 1 && (
        <>
          <Polyline positions={pts} interactive={false} pathOptions={{ color: "#111", weight: 7, opacity: 0.8 }} />
          <Polyline positions={pts} interactive={false} pathOptions={{ color: "#ffd43b", weight: 3, dashArray: "10 8" }} />
        </>
      )}
      {pts.map((p, i) => (
        <CircleMarker key={i} center={p} radius={6} interactive={false}
          pathOptions={{ color: "#111", weight: 2, fillColor: "#ffd43b", fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -6]} className="ruler-label">{labels[i]}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

/** Blue "you are here" dot with a cone showing where the top of the phone points.
 *  Only the cone's rotation is updated as the phone turns (cheap: no map re-render). */
const meIcon = L.divIcon({
  className: "", iconSize: [64, 64], iconAnchor: [32, 32],
  // notched black arrowhead just outside the dot (rotated to the phone's heading)
  html: `<div class="me-wrap"><div class="me-cone"><svg viewBox="-9 -11 18 21" width="18" height="21" aria-hidden="true">`
    + `<path d="M0,-10 L8,9 L0,4.5 L-8,9 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`
    + `<div class="me-dot"></div></div>`,
});
function MeMarker({ me, eventHandlers }: { me: NonNullable<Me>; eventHandlers: L.LeafletEventHandlerFnMap }) {
  const heading = useHeading(); // magnetic
  const ref = useRef<L.Marker | null>(null);
  const decl = useMemo(() => declinationAt(me.lat, me.lon), [Math.round(me.lat * 10), Math.round(me.lon * 10)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cone = ref.current?.getElement()?.querySelector(".me-cone") as HTMLElement | null;
    if (!cone) return;
    if (heading == null) { cone.style.display = "none"; return; }
    cone.style.display = "block";
    cone.style.transform = `rotate(${heading + decl}deg)`; // map is north-up, so use true heading
  }, [heading, decl]);
  return (
    <Marker position={[me.lat, me.lon]} icon={meIcon} ref={ref} zIndexOffset={1000} eventHandlers={eventHandlers}>
      <Tooltip direction="top" offset={[0, -10]}>You</Tooltip>
    </Marker>
  );
}

/** Quick shot: red line from you along the phone's (true) heading; re-renders on its own as the phone turns. */
function LiveBearing({ me }: { me: NonNullable<Me> }) {
  const heading = useHeading();
  const decl = useMemo(() => declinationAt(me.lat, me.lon), [Math.round(me.lat * 10), Math.round(me.lon * 10)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (heading == null) return null;
  const end = destination(me.lat, me.lon, heading + decl, 3000);
  const pts: [number, number][] = [[me.lat, me.lon], end];
  return (
    <>
      <Polyline positions={pts} interactive={false} pathOptions={{ color: "#fff", weight: 7, opacity: 0.85 }} />
      <Polyline positions={pts} interactive={false} pathOptions={{ color: "#e03131", weight: 3.5, dashArray: "12 8" }} />
    </>
  );
}
