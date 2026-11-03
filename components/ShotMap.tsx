"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef } from "react";
import {
  Circle, CircleMarker, LayersControl, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents,
} from "react-leaflet";
import { bearingTo, compassPoint, destination, distance, ellipsePolygon, formatDistance, type Sighting, type Sign, type Blind } from "@/lib/geo";
import { BLIND_STYLE, DEER_STYLE, SIGN_STYLE } from "@/lib/colors";
import type { Me, ShotView } from "./App";

const DEFAULT_CENTER: [number, number] = [45.0985, -78.3197];
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

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
function GoTo({ goto }: { goto: { lat: number; lon: number; n: number } | null }) {
  const map = useMap();
  const last = useRef(0);
  useEffect(() => {
    if (!goto || goto.n === last.current) return;
    last.current = goto.n;
    map.flyTo([goto.lat, goto.lon], Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [goto, map]);
  return null;
}

/** Ruler: every tap on the map adds a point. */
function RulerMode({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onAdd(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function ShotMap({ shots, sightings, signs, blinds, me, focus, pickStart, onCenter, goto, ruler, onRulerAdd, aim }: {
  shots: ShotView[]; sightings: Sighting[]; signs: Sign[]; blinds: Blind[]; me: Me; focus: { key: string; n: number } | null;
  /** set (even to null) while the crosshair is open */
  pickStart?: { lat: number; lon: number } | null;
  onCenter?: (lat: number, lon: number) => void;
  goto?: { lat: number; lon: number; n: number } | null;
  /** ruler points; undefined = ruler off */
  ruler?: [number, number][];
  onRulerAdd?: (lat: number, lon: number) => void;
  /** "On map" direction: line from the deer to the crosshair */
  aim?: { from: { lat: number; lon: number }; to: { lat: number; lon: number } };
}) {
  const icons = useMemo(() => new Map(shots.map((s) => [s.key, estimateIcon(s.color, String(s.index + 1))])), [shots]);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={13} className="map" zoomControl={false}>
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

      {pickStart !== undefined && onCenter && <PickMode start={pickStart} onCenter={onCenter} />}
      <GoTo goto={goto ?? null} />
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
        <Marker key={x.id} position={[x.lat, x.lon]} icon={blindIcon} zIndexOffset={-100}>
          <Tooltip permanent direction="right" offset={[10, 0]} className="blind-label">{x.name}</Tooltip>
          <Popup>
            <b>{x.title}</b> · {BLIND_STYLE[x.blind].label}<br />
            Added by {x.name}
            {x.note && <><br />“{x.note}”</>}
            <br />{x.lat.toFixed(5)}, {x.lon.toFixed(5)}
            {me && <><br />{formatDistance(distance(me.lat, me.lon, x.lat, x.lon))} {compassPoint(bearingTo(me.lat, me.lon, x.lat, x.lon))} of you</>}
          </Popup>
        </Marker>
      ))}

      {signs.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={signIcon(x)}>
          <Tooltip direction="right" offset={[12, 0]}>{SIGN_STYLE[x.sign].label}</Tooltip>
          <Popup>
            <b>{SIGN_STYLE[x.sign].label}</b><br />
            Marked by {x.name}, {new Date(x.time).toLocaleDateString([], { month: "short", day: "numeric" })} {fmtTime(x.time)}
            {x.note && <><br />“{x.note}”</>}
            {me && <><br />{formatDistance(distance(me.lat, me.lon, x.lat, x.lon))} {compassPoint(bearingTo(me.lat, me.lon, x.lat, x.lon))} of you</>}
          </Popup>
        </Marker>
      ))}

      {sightings.map((d) => <SightingLayer key={d.id} d={d} me={me} />)}

      {shots.map((s) => (
        <ShotLayer key={s.key} shot={s} me={me} icon={icons.get(s.key)!} />
      ))}

      {me && (
        <>
          <Circle center={[me.lat, me.lon]} radius={me.accuracy} pathOptions={{ color: "#1a73e8", weight: 1, fillOpacity: 0.1 }} />
          <CircleMarker center={[me.lat, me.lon]} radius={7}
            pathOptions={{ color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -6]}>You</Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  );
}

function ShotLayer({ shot, me, icon }: { shot: ShotView; me: Me; icon: L.DivIcon }) {
  const fix = shot.fix;
  return (
    <>
      {shot.reports.map((r) => {
        // Draw past the estimate if there is one, else a fixed length.
        const toFix = fix ? distance(r.lat, r.lon, fix.lat, fix.lon) : 0;
        const len = Math.max(4000, toFix + 1500);
        const end = destination(r.lat, r.lon, r.bearingTrue, len);
        return (
          <Fragment key={r.id}>
            <Polyline positions={[[r.lat, r.lon], end]} pathOptions={{ color: "#fff", weight: 6, opacity: 0.6 }} />
            <Polyline positions={[[r.lat, r.lon], end]} pathOptions={{ color: shot.color, weight: 3 }}>
              <Tooltip sticky>{r.name} · {Math.round(r.bearingTrue)}°</Tooltip>
            </Polyline>
            <CircleMarker center={[r.lat, r.lon]} radius={6}
              pathOptions={{ color: "#fff", weight: 2, fillColor: shot.color, fillOpacity: 1 }}>
              <Tooltip permanent direction="right" offset={[8, 0]} className="name-label">{r.name}</Tooltip>
              <Popup>
                <b>{r.name}</b> · Shot #{shot.index + 1}<br />
                Heard {fmtTime(r.shotTime)}<br />
                Bearing {Math.round(r.bearingTrue)}° true
                {r.bearingRef === "magnetic" && <> ({Math.round(r.bearingInput)}° magnetic)</>}<br />
                {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
              </Popup>
            </CircleMarker>
          </Fragment>
        );
      })}
      {fix && (
        <>
          <Polygon positions={ellipsePolygon(fix)}
            pathOptions={{ color: shot.color, weight: 2, dashArray: "6 4", fillColor: shot.color, fillOpacity: 0.15 }} />
          <Marker position={[fix.lat, fix.lon]} icon={icon}>
            <Popup>
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
            </Popup>
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
  return L.divIcon({
    className: "",
    iconSize: [w, 26],
    iconAnchor: [w / 2, 13],
    html: `<div class="deer-icon" style="--c:${st.color};width:${w}px">${label}</div>`,
  });
}

/** Deer marker + dashed arrow in its direction of travel. Older sightings fade. */
function SightingLayer({ d, me }: { d: Sighting; me: Me }) {
  const st = DEER_STYLE[d.deer];
  const ageH = (Date.now() - d.time) / 3600_000;
  const opacity = ageH < 1 ? 1 : ageH < 3 ? 0.75 : 0.5;
  const icon = useMemo(() => deerIcon(d), [d]);
  const LEN = 350; // metres
  let arrow: [number, number][] | null = null;
  let head: [number, number][] | null = null;
  if (d.heading != null) {
    const tip = destination(d.lat, d.lon, d.heading, LEN);
    arrow = [[d.lat, d.lon], tip];
    const back = destination(tip[0], tip[1], d.heading + 180, 70);
    head = [tip, destination(back[0], back[1], d.heading - 90, 35), destination(back[0], back[1], d.heading + 90, 35)];
  }
  return (
    <>
      {d.observer && (
        <Polyline positions={[[d.observer.lat, d.observer.lon], [d.lat, d.lon]]}
          pathOptions={{ color: "#333", weight: 1.5, dashArray: "2 6", opacity: 0.7 * opacity }} />
      )}
      {arrow && head && (
        <>
          <Polyline positions={arrow} pathOptions={{ color: "#fff", weight: 6, opacity: 0.6 * opacity }} />
          <Polyline positions={arrow} pathOptions={{ color: st.color, weight: 3, dashArray: "8 6", opacity }} />
          <Polygon positions={head} pathOptions={{ color: st.color, weight: 1, fillColor: st.color, fillOpacity: opacity, opacity }} />
        </>
      )}
      <Marker position={[d.lat, d.lon]} icon={icon} opacity={opacity}>
        <Tooltip direction="right" offset={[12, 0]}>{d.name} · {fmtTime(d.time)}</Tooltip>
        <Popup>
          <b>{d.count > 1 ? `${d.count} × ` : ""}{st.label}</b> seen by {d.name}<br />
          {fmtTime(d.time)}<br />
          {d.heading == null ? "Not moving" : <>Heading {compassPoint(d.heading)} ({Math.round(d.heading)}° true)</>}
          {d.note && <><br />“{d.note}”</>}
          {d.observer && <><br /><span style={{ color: "#666" }}>Spotted from {formatDistance(distance(d.observer.lat, d.observer.lon, d.lat, d.lon))} away (dotted line)</span></>}
          {me && (
            <>
              <br />
              {formatDistance(distance(me.lat, me.lon, d.lat, d.lon))} {compassPoint(bearingTo(me.lat, me.lon, d.lat, d.lon))} of you
            </>
          )}
        </Popup>
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
