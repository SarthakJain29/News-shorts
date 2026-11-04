"use client";
import { useEffect, useMemo, useState } from "react";
import { geoContains, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";

type Countries = FeatureCollection<Geometry, { name: string }>;
let cached: Promise<Countries> | null = null;

function loadCountries(): Promise<Countries> {
  cached ??= Promise.all([import("world-atlas/countries-110m.json"), import("topojson-client")]).then(([topo, tc]) => {
    const t = (topo.default ?? topo) as unknown as Parameters<typeof tc.feature>[0] & { objects: { countries: Parameters<typeof tc.feature>[1] } };
    return tc.feature(t, t.objects.countries) as unknown as Countries;
  });
  return cached;
}

/** Orthographic globe that spins to the story's location — generated in-app from Natural Earth data. */
export default function GlobeMap({ lat, lon, place, size = 300 }: { lat: number; lon: number; place: string; size?: number }) {
  const [world, setWorld] = useState<Countries | null>(null);
  const [rot, setRot] = useState<[number, number]>([-lon + 70, -lat * 0.4]);

  useEffect(() => {
    let alive = true;
    loadCountries().then((w) => alive && setWorld(w));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const from: [number, number] = [-lon + 70, -lat * 0.4];
    const to: [number, number] = [-lon, -lat * 0.85];
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1600);
      const e = 1 - Math.pow(1 - k, 3);
      setRot([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [lat, lon]);

  const projection = useMemo(() => geoOrthographic().scale(size / 2 - 4).translate([size / 2, size / 2]).rotate([rot[0], rot[1]]).clipAngle(90), [rot, size]);
  const path = geoPath(projection);
  const hit = useMemo(() => world?.features.find((f) => geoContains(f as Feature, [lon, lat])), [world, lat, lon]);
  const pt = projection([lon, lat]);

  return (
    <figure className="globe" aria-label={`Map: ${place}`}>
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
          <g transform={`translate(${pt[0]},${pt[1]})`}>
            <circle r="18" className="globe-ping" />
            <circle r="6" className="globe-dot" />
          </g>
        )}
      </svg>
      <figcaption className="mono-chip">{place}{hit && !place.includes(hit.properties.name) ? ` · ${hit.properties.name}` : ""}</figcaption>
    </figure>
  );
}
