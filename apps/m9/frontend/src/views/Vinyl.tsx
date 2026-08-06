// Vinyl.tsx — one deck drawn as a record: grooves that turn while the transport runs, and the
// label carrying the artist and the title of what is loaded. Pure presentation, no engine.

/** Where the grooves sit, as fractions of the radius — dense at the rim, sparse toward the label. */
const GROOVES = [0.97, 0.93, 0.89, 0.85, 0.8, 0.75, 0.69, 0.63, 0.57];

export function Vinyl({
  side,
  artist,
  title,
  spinning,
  onPick,
}: {
  /** "A" or "B" — the deck's own name, shown on the label when nothing is loaded. */
  side: string;
  artist: string | null;
  title: string | null;
  /** Turning: the transport is running AND this deck is holding something. */
  spinning: boolean;
  /** Open the song browser for this deck. The LABEL is the target — the middle of a record
   *  is where its name is, so it is where you press to change it. */
  onPick: () => void;
}) {
  const loaded = !!title;
  return (
    <div className="relative aspect-square w-full max-w-[22rem] select-none">
      <svg
        viewBox="0 0 100 100"
        className={`h-full w-full ${spinning ? "m9-spin" : ""}`}
        // The record turns; the LABEL below does not. On a real deck it would, but a title
        // you have to tilt your head to read is a worse trade than the lost realism.
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
        {/* One bright groove, off-centre in the stack: it is what makes the rotation VISIBLE.
            A perfectly uniform disc spinning looks completely still. */}
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

      {/* The label, centred over the disc and held still. The disc itself stays
          `pointer-events-none` so only the label takes the click — a record's middle is
          where its name is, and grabbing the outer groove will one day mean scratching. */}
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
