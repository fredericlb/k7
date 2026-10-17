// shapeSchematics.tsx — one line drawing per ARCHETYPE: the screen it opens on, reduced to its
// marks (lanes and clips, two platters, a frame, a fader). These are pictures of a screen rather
// than icons, so they are drawn here and not taken from @frediverse/ui/icons; they inherit
// `currentColor`, which is how the picked card turns them violet. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type { ReactNode } from "react";

/** The clips of the drawn lanes, each with the lane it sits on: a fixed picture, keyed by where it is. */
const CLIPS: { lane: number; x: number; w: number }[] = [
  { lane: 0, x: 6, w: 22 },
  { lane: 0, x: 34, w: 18 },
  { lane: 1, x: 14, w: 26 },
  { lane: 1, x: 46, w: 14 },
  { lane: 2, x: 6, w: 12 },
  { lane: 2, x: 24, w: 30 },
];

/** Lanes with clips and a playhead: what an arrangement opens on. */
function Lanes({ y = 6, rows = 3 }: { y?: number; rows?: number }) {
  return (
    <>
      {CLIPS.filter((c) => c.lane < rows).map(({ lane, x, w }) => (
        <rect
          key={`${lane}:${x}`}
          x={x}
          y={y + lane * 11}
          width={w}
          height={7}
          rx={1.5}
          fill="currentColor"
          fillOpacity={0.28}
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
      <line
        x1={40}
        x2={40}
        y1={y - 3}
        y2={y + rows * 11}
        stroke="currentColor"
        strokeWidth={1.25}
      />
    </>
  );
}

/** A picture frame, with a horizon in it so it reads as an image. */
function Frame({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill="currentColor"
        fillOpacity={0.12}
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <path
        d={`M${x + 3} ${y + h - 3} L${x + w * 0.4} ${y + h * 0.45} L${x + w * 0.62} ${y + h * 0.7} L${x + w * 0.75} ${y + h * 0.55} L${x + w - 3} ${y + h - 3}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </>
  );
}

/** A vertical fader: its slot and its cap. */
function Fader({ x }: { x: number }) {
  return (
    <>
      <line
        x1={x}
        x2={x}
        y1={10}
        y2={46}
        stroke="currentColor"
        strokeWidth={1}
        strokeOpacity={0.6}
      />
      <rect
        x={x - 5}
        y={20}
        width={10}
        height={6}
        rx={1.5}
        fill="currentColor"
        fillOpacity={0.35}
        stroke="currentColor"
        strokeWidth={1}
      />
    </>
  );
}

/** The output: a speaker cone. */
function Speaker({ x }: { x: number }) {
  return (
    <path
      d={`M${x} 23 h5 l7 -6 v22 l-7 -6 h-5 z`}
      fill="currentColor"
      fillOpacity={0.2}
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
    />
  );
}

/** A dashed cable between two points, the signal's path in a rig. */
const Cable = ({ x1, x2 }: { x1: number; x2: number }) => (
  <line
    x1={x1}
    x2={x2}
    y1={28}
    y2={28}
    stroke="currentColor"
    strokeWidth={1}
    strokeDasharray="2 2"
  />
);

/** A platter: grooves, a label, a spindle. */
function Platter({ cx }: { cx: number }) {
  return (
    <>
      <circle
        cx={cx}
        cy={24}
        r={16}
        fill="currentColor"
        fillOpacity={0.12}
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <circle
        cx={cx}
        cy={24}
        r={11}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.75}
        strokeOpacity={0.5}
      />
      <circle cx={cx} cy={24} r={5} fill="currentColor" fillOpacity={0.35} />
    </>
  );
}

/** A RECORD and not a list: an archetype added to `PROJECT_SHAPES` without its drawing stops compiling. */
const DRAWN: Record<ProjectShape, ReactNode> = {
  arrangement: <Lanes y={14} rows={3} />,
  mix: (
    <>
      <Platter cx={24} />
      <Platter cx={72} />
      <line
        x1={36}
        x2={60}
        y1={50}
        y2={50}
        stroke="currentColor"
        strokeWidth={1}
        strokeOpacity={0.6}
      />
      <rect
        x={44}
        y={46}
        width={8}
        height={8}
        rx={1.5}
        fill="currentColor"
        fillOpacity={0.35}
        stroke="currentColor"
        strokeWidth={1}
      />
    </>
  ),
  video: (
    <>
      <Lanes y={30} rows={2} />
      <Frame x={52} y={4} w={38} h={22} />
    </>
  ),
  live: (
    <>
      <circle
        cx={14}
        cy={28}
        r={6}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <circle cx={14} cy={28} r={2} fill="currentColor" />
      <Cable x1={21} x2={42} />
      <Fader x={48} />
      <Cable x1={54} x2={72} />
      <Speaker x={73} />
    </>
  ),
  "live-video": (
    <>
      <circle
        cx={16}
        cy={26}
        r={10}
        fill="currentColor"
        fillOpacity={0.12}
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <circle
        cx={16}
        cy={26}
        r={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <line
        x1={10}
        x2={22}
        y1={42}
        y2={42}
        stroke="currentColor"
        strokeWidth={1.25}
      />
      <Cable x1={28} x2={46} />
      <Frame x={48} y={12} w={42} h={30} />
    </>
  ),
};

/** The archetype's screen, drawn at 96×56 in the current colour; decorative, the card's text says it. */
export function ShapeSchematic({ shape }: { shape: ProjectShape }) {
  return (
    <svg
      viewBox="0 0 96 56"
      className="h-14 w-24 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {DRAWN[shape]}
    </svg>
  );
}
