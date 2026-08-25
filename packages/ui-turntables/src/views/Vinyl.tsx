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

/** One turn at 33⅓ rpm, the speed the record is CUT at — what a ratio of 1 means. */
const TURN_SECONDS = 1.8;

/** How long a platter takes to give up its speed. A real one coasts; a CSS class stops dead. */
const COAST_MS = 900;

/** How fast a hand may drive the record. The plugin's own ceiling — past it nothing is a pitch. */
const MAX_RATE = 4;

/** The angle of a pointer around the record's centre, in radians. */
function angleAt(box: DOMRect, x: number, y: number): number {
  return Math.atan2(
    y - (box.top + box.height / 2),
    x - (box.left + box.width / 2),
  );
}

/** The shorter way round between two angles — without it every wrap past π reads as a full turn. */
function shortest(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function Vinyl({
  side,
  artist,
  title,
  spinning,
  ratio,
  onPick,
  at,
  length,
  markers,
  size,
  onScratch,
}: {
  /** "A" or "B" — the deck's own name, shown on the label when nothing is loaded. */
  side: string;
  artist: string | null;
  title: string | null;
  /** Turning: the transport is running AND this deck is holding something. */
  spinning: boolean;
  /** How fast, as a multiple of 33⅓ rpm — the deck's own stretch, so a pitched record LOOKS pitched. */
  ratio: number;
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
  /** Drive the record by hand: a signed rate while dragging, `null` on release — ../../docs/scratch.md. */
  onScratch?: (rate: number | null) => void;
}) {
  const loaded = !!title;
  const wedge = useRef<SVGPathElement>(null);
  const disc = useRef<SVGSVGElement>(null);
  // Read by the frame loop, which must not be restarted by a pitch fader moving — hence refs, not deps.
  const wanted = useRef(0);
  wanted.current = spinning ? ratio : 0;
  /** While a hand holds the record, the drawing follows the FINGER and not the integrated speed. */
  const held = useRef<number | null>(null);

  /** Take hold of the record: the rate becomes the hand's, and the drawing sticks to the pointer. */
  const grab = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onScratch) return;
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    let was = angleAt(box, e.clientX, e.clientY);
    let at = performance.now();
    held.current = 0;
    onScratch(0);
    const move = (ev: PointerEvent) => {
      const now = performance.now();
      const angle = angleAt(box, ev.clientX, ev.clientY);
      const turned = shortest(was, angle);
      const dt = Math.max(1, now - at);
      // One turn is TURN_SECONDS of record at rate 1, so a hand's turns per second ARE its rate.
      const rate = ((turned / (2 * Math.PI)) * 1000 * TURN_SECONDS) / dt;
      was = angle;
      at = now;
      held.current = (held.current ?? 0) + (turned * 180) / Math.PI;
      onScratch(Math.max(-MAX_RATE, Math.min(MAX_RATE, rate)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      held.current = null;
      // Null and not 0: letting go hands the record back to whatever it was doing, docs/scratch.md.
      onScratch(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The progress AND the rotation, per frame and never through React — `length` changes what a position MEANS.
  useEffect(() => {
    let frame = 0;
    let angle = 0;
    let speed = 0;
    let last = performance.now();
    // A CSS keyframe cannot do either half of this: it cannot take a live rate, and it stops dead.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100); // a backgrounded tab must not spin the record a full turn
      last = now;
      const el = wedge.current;
      if (el) el.setAttribute("d", wedgePath(progressOf(at(), length), FILL_R));
      if (!still) {
        // A HELD record follows the finger outright; nothing is eased, because nothing is coasting.
        if (held.current !== null) {
          angle = held.current % 360;
          speed = 0;
        } else {
          // Eased toward the wanted rate rather than set to it: a platter takes its time both ways.
          const k = 1 - Math.exp(-dt / COAST_MS);
          speed += (wanted.current - speed) * k;
          angle = (angle + (360 * (dt / 1000) * speed) / TURN_SECONDS) % 360;
        }
        if (disc.current)
          disc.current.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      }
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
        ref={disc}
        viewBox="0 0 100 100"
        className={`h-full w-full ${onScratch ? "cursor-grab touch-none" : ""}`}
        // The GROOVES take the hand; the label above them keeps its click, being a separate element.
        onPointerDown={grab}
        // The record turns; the LABEL below does not — a title you tilt your head to read is worse.
        aria-hidden="true"
      >
        {/* One title, not two: it names the record AND says what the hand may do with it. */}
        <title>
          {loaded ? `${artist ?? ""} ${title}` : `platine ${side}`}
          {onScratch ? " — tourner le disque à la main" : ""}
        </title>
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
