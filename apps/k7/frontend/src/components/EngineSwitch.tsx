// EngineSwitch.tsx — the header's engine, right of the project's name: which one plays this
// project, and the others that answer, to move to. The list is MEASURED when the menu opens, not
// kept, since an engine listed minutes ago may be gone. Switching remounts the project on the new
// engine: the files are the server's, so nothing is lost but the playing position. See ../../docs/shell.md.

import { Button } from "@frediverse/ui/button";
import {
  Check,
  Loader2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { Compatibility } from "@studio/engine-browser/compat";
import { formatLatency } from "@studio/web-protocol/quality";
import { useEffect, useRef, useState } from "react";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";
import type { RankedEngine } from "../types";

const nameOf = (r: RankedEngine): string =>
  r.engine.hostname || r.engine.id.slice(0, 8);

export function EngineSwitch({
  current,
  onSwitch,
  compat,
  audioToBrowser = false,
  searching = false,
}: {
  /** The engine playing this project, or null while there is none — the project is open and silent. */
  current: RankedEngine | null;
  onSwitch: (r: RankedEngine) => void;
  /** How compatible `current` is with the open project; under 100 draws a warning beside its name. Null: not known, nothing drawn. */
  compat?: Compatibility | null;
  /** The engine's sound is played by this page rather than by its own machine — what the label says. */
  audioToBrowser?: boolean;
  /** The first engine is still being looked for. */
  searching?: boolean;
}) {
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
  // What the warning says, or null when there is none to draw.
  const incompatible =
    compat && compat.score < 100
      ? m["engineSwitch.incompatible"]({
          score: compat.score,
          missing: compat.missing.map((p) => p.name).join(", "),
        })
      : null;
  const [open, setOpen] = useState(false);
  const [ranked, setRanked] = useState<RankedEngine[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRanked(null);
    void engines
      .find()
      .then((l) => alive && setRanked(l.ranked))
      .catch(() => alive && setRanked([]));
    return () => {
      alive = false;
    };
  }, [open]);

  // Registered while open so the shell's Esc closes this menu and nothing under it (popins.ts).
  usePopin(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const id = setTimeout(() => window.addEventListener("pointerdown", onDown));
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        size="xs"
        variant="ghost"
        className={cn(
          "h-6 gap-1 px-1.5 text-xs hover:text-foreground",
          current || searching ? "text-muted-foreground" : "text-amber-500",
        )}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={hint}
      >
        {current ? (
          <Volume2 className="h-3 w-3 shrink-0" />
        ) : searching ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <VolumeX className="h-3 w-3 shrink-0" />
        )}
        <span className="max-w-[12rem] truncate">{label}</span>
        {incompatible && (
          <span
            className="flex shrink-0 text-amber-500"
            title={incompatible}
            role="img"
            aria-label={incompatible}
          >
            <TriangleAlert className="h-3 w-3" />
          </span>
        )}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex min-w-[16rem] flex-col rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {ranked === null ? (
            <span className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {m["engines.searching"]()}
            </span>
          ) : ranked.length === 0 ? (
            <span className="max-w-[20rem] px-2 py-1 text-xs text-muted-foreground">
              {m["engines.none"]()}
            </span>
          ) : (
            ranked.map((r) => {
              const isCurrent = r.engine.id === current?.engine.id;
              // Another tab or person holding it is a refusal the lease would give anyway, said before the click.
              const busy = !isCurrent && r.engine.assigned;
              const usable = !!r.latency && !!r.wsUrl && !busy;
              return (
                <button
                  key={r.engine.id}
                  type="button"
                  role="menuitem"
                  disabled={isCurrent || !usable}
                  onClick={() => {
                    setOpen(false);
                    onSwitch(r);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                    isCurrent
                      ? "text-foreground"
                      : usable
                        ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                        : "cursor-not-allowed text-faint",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      !isCurrent && "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{nameOf(r)}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {busy
                      ? m["engineSwitch.inUse"]()
                      : r.latency
                        ? formatLatency(r.latency)
                        : m["engines.unreachable"]()}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
