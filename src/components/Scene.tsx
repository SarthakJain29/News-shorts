"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Visual } from "@/lib/types";

const GlobeMap = dynamic(() => import("./GlobeMap"), { ssr: false, loading: () => <div className="globe" /> });

/** Animate the numeric part of a figure like "$6.3bn" or "1,200" from 0. */
export function CountUp({ value, play }: { value: string; play: boolean }) {
  const m = value.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  const target = m ? Number(m[2].replace(/,/g, "")) : NaN;
  const decimals = m?.[2].split(".")[1]?.length ?? 0;
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!play || Number.isNaN(target)) return;
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1100);
      setK(1 - Math.pow(1 - p, 4));
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [play, target]);
  if (!m || Number.isNaN(target)) return <>{value}</>;
  const n = target * (play ? k : 1);
  const shown = n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <>
      {m[1]}
      {shown}
      {m[3]}
    </>
  );
}

export function Scene({ visual, title, trackLabel, keyId, play }: { visual: Visual | null; title: string; trackLabel: string; keyId: string; play: boolean }) {
  if (!visual) {
    return (
      <div className="scene scene-title" key={keyId}>
        <span className="mono-chip">{trackLabel} explainer</span>
        <h2 className="kinetic">{title.split(" ").map((w, i) => <span key={i} style={{ animationDelay: `${i * 55}ms` }}>{w}</span>)}</h2>
      </div>
    );
  }
  switch (visual.kind) {
    case "headline":
      return (
        <div className="scene scene-headline" key={keyId}>
          <h2 className="kinetic">{visual.text.split(" ").map((w, i) => <span key={i} style={{ animationDelay: `${i * 70}ms` }}>{w}</span>)}</h2>
        </div>
      );
    case "number":
      return (
        <div className="scene scene-number" key={keyId}>
          <div className="big-number"><CountUp value={visual.value} play={play} /></div>
          <p className="scene-label">{visual.label}</p>
        </div>
      );
    case "chart": {
      const max = Math.max(...visual.bars.map((b) => Math.abs(b.value))) || 1;
      return (
        <div className="scene scene-chart" key={keyId}>
          <p className="scene-label">{visual.title}</p>
          <ul className="bars">
            {visual.bars.map((b, i) => (
              <li key={i} style={{ ["--w" as string]: `${(Math.abs(b.value) / max) * 100}%`, animationDelay: `${i * 120}ms` }}>
                <span className="bar-label">{b.label}</span>
                <span className="bar"><i /></span>
                <span className="bar-value">{b.value.toLocaleString("en-US")}{visual.unit ? ` ${visual.unit}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "map":
      return (
        <div className="scene scene-map" key={keyId}>
          <GlobeMap lat={visual.lat} lon={visual.lon} place={visual.place} />
        </div>
      );
    case "timeline":
      return (
        <div className="scene scene-timeline" key={keyId}>
          <ol>
            {visual.items.map((it, i) => (
              <li key={i} style={{ animationDelay: `${i * 160}ms` }}>
                <span className="mono-chip">{it.when}</span>
                <span>{it.what}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "compare":
      return (
        <div className="scene scene-compare" key={keyId}>
          <div className="cmp"><span className="big-number sm"><CountUp value={visual.left.value} play={play} /></span><span className="scene-label">{visual.left.label}</span></div>
          <span className="vs">vs</span>
          <div className="cmp"><span className="big-number sm"><CountUp value={visual.right.value} play={play} /></span><span className="scene-label">{visual.right.label}</span></div>
        </div>
      );
  }
}
