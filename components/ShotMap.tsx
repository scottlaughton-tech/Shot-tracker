"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef } from "react";
import {
  Circle, CircleMarker, LayersControl, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap,
} from "react-leaflet";
import { bearingTo, compassPoint, destination, distance, ellipsePolygon, formatDistance } from "@/lib/geo";
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
function FitBounds({ shots, me, focus }: { shots: ShotView[]; me: Me; focus: { key: string; n: number } | null }) {
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
      if (p.length) {
        didInitial.current = true;
        map.fitBounds(L.latLngBounds(p), { padding: [40, 40], maxZoom: 15 });
      } else if (me) {
        didInitial.current = true;
        map.setView([me.lat, me.lon], 14);
      }
    }
  }, [shots, me, focus, map]);
  return null;
}

export default function ShotMap({ shots, me, focus }: { shots: ShotView[]; me: Me; focus: { key: string; n: number } | null }) {
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

      <FitBounds shots={shots} me={me} focus={focus} />

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
