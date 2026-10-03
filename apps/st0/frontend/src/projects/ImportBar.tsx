// ImportBar.tsx — where an import is: one segment per step (the clone, the libraries, the media),
// the current one filled by its percentage, and a line saying which step and what git is doing.
// A step that cannot be measured pulses instead of standing still. See ../../docs/projects.md.

import { cn } from "@frediverse/ui/lib/utils";
import { CLONE_STEPS, type CloneStep } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";
import type { ImportProgress } from "./workspaceOps";

const STEP_NAME: Record<CloneStep, () => string> = {
  clone: () => m["ws.importStepClone"](),
  libraries: () => m["ws.importStepLibraries"](),
  media: () => m["ws.importStepMedia"](),
};

export function ImportBar({ progress }: { progress: ImportProgress }) {
  const at = CLONE_STEPS.indexOf(progress.step);
  const { percent } = progress;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {m["ws.importStep"]({
            n: at + 1,
            total: CLONE_STEPS.length,
            name: STEP_NAME[progress.step](),
          })}
        </span>
        {percent !== null && (
          <span className="tabular-nums text-muted-foreground">{percent}%</span>
        )}
      </div>
      <div className="flex gap-1">
        {CLONE_STEPS.map((s, i) => (
          <div
            key={s}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full bg-primary transition-[width] duration-500",
                i === at && percent === null && "animate-pulse",
              )}
              style={{
                width:
                  i < at
                    ? "100%"
                    : i > at
                      ? "0%"
                      : percent === null
                        ? "100%"
                        : `${percent}%`,
                opacity: i === at && percent === null ? 0.4 : 1,
              }}
            />
          </div>
        ))}
      </div>
      {/* git's own words for what it is doing — "Receiving objects", "Resolving deltas". */}
      {progress.detail && (
        <span className="truncate text-muted-foreground text-xs">
          {progress.detail}
        </span>
      )}
    </div>
  );
}
