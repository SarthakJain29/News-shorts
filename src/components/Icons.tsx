import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const IconPlay = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" /></svg>;
export const IconPause = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></svg>;
export const IconBookmark = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => <svg {...base(p)}><path d="M6 3.5h12v17l-6-4.2-6 4.2z" fill={filled ? "currentColor" : "none"} /></svg>;
export const IconShare = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 13v6.5h14V13" /></svg>;
export const IconSources = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 5.5h7v14H4zM13 5.5h7v14h-7z" /><path d="M6.5 9h2M6.5 12h2M15.5 9h2M15.5 12h2" /></svg>;
export const IconSpark = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" /></svg>;
export const IconVolume = ({ muted, ...p }: SVGProps<SVGSVGElement> & { muted?: boolean }) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 010 6M18.5 6.5a8 8 0 010 11" />}
  </svg>
);
export const IconCC = ({ on, ...p }: SVGProps<SVGSVGElement> & { on?: boolean }) => <svg {...base(p)}><rect x="3" y="5.5" width="18" height="13" rx="3" strokeDasharray={on ? undefined : "3 2.5"} /><path d="M10.5 10.2a2.2 2.2 0 100 3.6M17 10.2a2.2 2.2 0 100 3.6" /></svg>;
export const IconClose = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconExternal = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>;
export const IconBolt = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" fill="currentColor" stroke="none" /></svg>;
export const IconSliders = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
export const IconRestart = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 12a8 8 0 108-8H8" /><path d="M10.5 1.5L8 4l2.5 2.5" /></svg>;
export const IconArrowDown = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 4v16M6 14l6 6 6-6" /></svg>;
