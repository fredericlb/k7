// Vinyl.tsx — one deck drawn as a record: grooves that turn while the transport runs, the
// progress filling the disc, the cues around it, and the label carrying what is loaded.
// See ../../docs/vinyl.md.

import { useEffect, useRef } from "react";
import { CUE_COLOURS } from "../deck";
import { CENTRE, pointOnDial, progressOf, wedgePath } from "../dial";

/** Where the grooves sit, as fractions of the radius — dense at the rim, sparse toward the label. */
const GROOVES = [0.97, 0.93, 0.89, 0.85, 0.8, 0.75, 0.69, 0.63, 0.57];

/** The disc the progress fills. The cues are RADII across the same disc — see below. */
const FILL_R = 49;

export function Vinyl({
  side,
  artist,
  title,
  spinning,
  onPick,
  at,
  length,
  markers,
  size,
}: {
  /** "A" or "B" — the deck's own name, shown on the label when nothing is loaded. */
  side: string;
  artist: string | null;
  title: string | null;
  /** Turning: the transport is running AND this deck is holding something. */
  spinning: boolean;
  /** Open the song browser for this deck — the LABEL is the target, being where a record's name is. */
  onPick: () => void;
  /** How far into the FILE the deck is RIGHT NOW — a FUNCTION, so the wedge moves without a re-render. */
  at: () => number;
  /** The song's length in its own seconds. 0 until the analysis lands — see `progressOf`. */
  length: number;
  /** The cues, positional by button. Drawn as circles around the dial at their own moment. */
  markers: readonly (number | null)[];
  /** How big the record may be, from `deskLayout` — a cap on the WIDTH, which is what bounds the height. */
  size: number;
}) {
  const loaded = !!title;
  const wedge = useRef<SVGPathElement>(null);

  // The progress, redrawn per frame and never through React — `length` changes what a position MEANS.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = wedge.current;
      if (el) el.setAttribute("d", wedgePath(progressOf(at(), length), FILL_R));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [at, length]);
  return (
    <div
      className="relative aspect-square w-full shrink-0 select-none"
      style={{ maxWidth: `${size}px` }}
    >
      <svg
        viewBox="0 0 100 100"
        // 1.8 s a turn — 33⅓ rpm, on Tailwind's own `spin`, so no keyframes of ours to define.
        className={`h-full w-full ${spinning ? "animate-[spin_1.8s_linear_infinite]" : ""}`}
        // The record turns; the LABEL below does not — a title you tilt your head to read is worse.
        aria-hidden="true"
      >
        <title>{loaded ? `${artist ?? ""} ${title}` : `platine ${side}`}</title>
        <defs>
          {/* Not flat black: a record reads as one because the light moves across it. */}
          <radialGradient id={`vinyl-${side}`} cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#101014" />
            <stop offset="82%" stopColor="#26262e" />
            <stop offset="100%" stopColor="#0b0b0e" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="49" fill={`url(#vinyl-${side})`} />
        {GROOVES.map((r) => (
          <circle
            key={r}
            cx="50"
            cy="50"
            r={r * 49}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.055}
            strokeWidth={0.35}
          />
        ))}
        {/* One bright groove, off-centre: a perfectly uniform disc spinning looks completely still. */}
        <circle
          cx="50"
          cy="50"
          r={0.71 * 49}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.16}
          strokeWidth={0.5}
          strokeDasharray="1.6 26"
        />
      </svg>

      {/* The progress and the cues, on a layer that does NOT turn — ../../docs/vinyl.md. */}
      <svg
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* Empty at 0 and the whole disc at 1, translucent so the grooves stay legible under it. */}
        <path ref={wedge} d="" fill="#ffffff" fillOpacity={0.12} />
        {/* A cue is a RADIUS, centre to rim, not a dot on a ring — ../../docs/vinyl.md. */}
        {markers.map((m, i) =>
          m == null || !(length > 0) ? null : (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: the slot IS the identity — a cue is a fixed button, never a row that reorders.
              key={i}
              x1={CENTRE}
              y1={CENTRE}
              x2={pointOnDial(progressOf(m, length), FILL_R).x}
              y2={pointOnDial(progressOf(m, length), FILL_R).y}
              stroke={CUE_COLOURS[i % CUE_COLOURS.length]}
              strokeWidth={1.1}
              strokeLinecap="round"
            />
          ),
        )}
      </svg>

      {/* The label, centred and held still, and the only thing that takes the click. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <button
          type="button"
          onClick={onPick}
          title={
            loaded
              ? "changer le morceau de cette platine"
              : "choisir un morceau"
          }
          className={`pointer-events-auto flex aspect-square w-[46%] cursor-pointer flex-col items-center justify-center rounded-full px-3 text-center transition-shadow hover:ring-2 hover:ring-foreground/30 ${
            loaded
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {loaded ? (
            <>
              {artist ? (
                <span className="line-clamp-2 w-full text-[0.7rem] leading-tight opacity-80">
                  {artist}
                </span>
              ) : null}
              <span className="line-clamp-3 w-full text-sm font-semibold leading-tight">
                {title}
              </span>
            </>
          ) : (
            <span className="text-xs">platine {side}</span>
          )}
          {/* The spindle hole — the one detail that makes the ring read as a label. */}
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-background" />
        </button>
      </div>
    </div>
  );
}
