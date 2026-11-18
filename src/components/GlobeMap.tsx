"use client";
import { useEffect, useMemo, useState } from "react";
import { geoContains, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";

type Countries = FeatureCollection<Geometry, { name: string }>;
let cached: Promise<Countries> | null = null;

export function preloadCountries(): Promise<Countries> {
  cached ??= Promise.all([import("world-atlas/countries-110m.json"), import("topojson-client")]).then(([topo, tc]) => {
    const t = (topo.default ?? topo) as unknown as Parameters<typeof tc.feature>[0] & { objects: { countries: Parameters<typeof tc.feature>[1] } };
    return tc.feature(t, t.objects.countries) as unknown as Countries;
  });
  return cached;
}

const SPIN_SEC = 1.6;

/**
 * Orthographic globe that spins to the story location — generated in-app from Natural Earth data.
 * `t` is seconds since the scene appeared, so the motion is a pure function of playback time (pauses with the
 * narration and renders identically frame-by-frame for video export).
 */
export default function GlobeMap({ lat, lon, place, t, size = 300 }: { lat: number; lon: number; place: string; t: number; size?: number }) {
  const [world, setWorld] = useState<Countries | null>(null);
  useEffect(() => {
    let alive = true;
    preloadCountries().then((w) => alive && setWorld(w));
    return () => {
      alive = false;
    };
  }, []);

  const k = Math.min(1, Math.max(0, t / SPIN_SEC));
  const e = 1 - Math.pow(1 - k, 3);
  const rot: [number, number] = [-lon + 70 + (-70) * e, -lat * 0.4 + (-lat * 0.85 + lat * 0.4) * e];

  const projection = useMemo(() => geoOrthographic().scale(size / 2 - 4).translate([size / 2, size / 2]).rotate(rot).clipAngle(90), [rot[0], rot[1], size]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = geoPath(projection);
  const hit = useMemo(() => world?.features.find((f) => geoContains(f as Feature, [lon, lat])), [world, lat, lon]);
  const pt = projection([lon, lat]);

  return (
    <figure className="globe" aria-label={`Map: ${place}`} data-ready={world ? "1" : undefined}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" role="img">
        <defs>
          <radialGradient id="globe-shade" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </radialGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} className="globe-sea" />
        <path d={path(geoGraticule10()) ?? ""} className="globe-grid" />
        {world?.features.map((f, i) => (
          <path key={i} d={path(f) ?? ""} className={f === hit ? "globe-land hit" : "globe-land"} />
        ))}
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill="url(#globe-shade)" pointerEvents="none" />
        {pt && (
          <g transform={`translate(${pt[0]},${pt[1]})`} opacity={k}>
            <circle r="18" className="globe-ping" />
            <circle r="6" className="globe-dot" />
          </g>
        )}
      </svg>
      <figcaption className="mono-chip">{place}{hit && !place.includes(hit.properties.name) ? ` · ${hit.properties.name}` : ""}</figcaption>
    </figure>
  );
}
