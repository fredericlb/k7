// engineWords.tsx — what an engine selector SAYS: where the sound comes out, the hint, the
// incompatibility warning and the icon, for the project bar and the home pages' bar alike, so the
// two never word one engine two ways. See ../../docs/shell.md.

import { Loader2, TriangleAlert, Volume2, VolumeX } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { Compatibility } from "@studio/engine-browser/compat";
import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";

/** What the selector shows and does — App's live session in a project, `HomeEngine`'s probe on the home pages. */
export interface EngineSelectorProps {
  current: RankedEngine | null;
  /** The first engine is still being looked for. */
  searching: boolean;
  /** How compatible `current` is with the open project; under 100 draws a warning. */
  compat?: Compatibility | null;
  /** The engine's sound is played by this page rather than by its own machine. */
  audioToBrowser?: boolean;
  /** The figures beside the name — the session's link in a project, the probe's elsewhere. */
  stats?: ReactNode;
  onChange: () => void;
}

const nameOf = (r: RankedEngine): string =>
  r.engine.hostname || r.engine.id.slice(0, 8);

/** What the selector says and shows, for the bar's engine slot (BarEngine.tsx). */
export function engineWords({
  current,
  searching,
  compat,
  audioToBrowser = false,
}: Pick<
  EngineSelectorProps,
  "current" | "searching" | "compat" | "audioToBrowser"
>) {
  // Where the sound comes out, said in words: a laptop driving the desktop at home is otherwise silent with no reason given.
  const label = current
    ? audioToBrowser
      ? m["engineSwitch.soundHere"]()
      : m["engineSwitch.soundOn"]({ engine: nameOf(current) })
    : searching
      ? m["engines.searching"]()
      : m["engineSwitch.noSound"]();
  const hint = current
    ? audioToBrowser
      ? m["engineSwitch.hintHere"]({ engine: nameOf(current) })
      : m["engineSwitch.hint"]({ engine: nameOf(current) })
    : m["engineSwitch.noSoundHint"]();
  const incompatible =
    compat && compat.score < 100
      ? m["engineSwitch.incompatible"]({
          score: compat.score,
          missing: compat.missing.map((p) => p.name).join(", "),
        })
      : null;
  const Icon = current ? Volume2 : searching ? Loader2 : VolumeX;
  const icon = (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0",
        !current && searching && "animate-spin",
        !current && !searching && "text-amber-500",
      )}
    />
  );
  return { label, hint, incompatible, icon };
}

/** The incompatibility triangle, beside the engine's name. */
export function EngineWarning({ text }: { text: string }) {
  return (
    <span
      className="flex shrink-0 text-amber-500"
      title={text}
      role="img"
      aria-label={text}
    >
      <TriangleAlert className="h-3.5 w-3.5" />
    </span>
  );
}
