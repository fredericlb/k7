// EngineLoad — the engine's own memory in the header, beside the master meter, with the plugins'
// summed share of the audio block in its tooltip. The per-node figures cannot add up to it, since
// plugins share one heap (engine/st0-engine/docs/load.md).
// The one thing a reader would get wrong: it is the engine PROCESS's figure, not this project's.

import { cn } from "@frediverse/ui/lib/utils";
import { useEngineState } from "@studio/engine-browser/store";
import { formatBytes } from "@studio/ui-chains-react/node-load";
import { m } from "../paraglide/messages.js";

const MB = 1024 * 1024;

export function EngineLoad({ className }: { className?: string }) {
  // Whole MB and whole percents, so a frame that moves neither re-renders nothing.
  const mb = useEngineState((s) =>
    s.load?.process !== undefined ? Math.round(s.load.process / MB) : null,
  );
  const cpu = useEngineState((s) =>
    s.load
      ? Math.round(
          Object.values(s.load.plugins).reduce((a, p) => a + p.cpu, 0) * 100,
        )
      : null,
  );
  if (mb === null) return null;
  const memory = formatBytes(mb * MB);
  return (
    <span
      className={cn(
        "cursor-default font-mono text-[10px] tabular-nums text-muted-foreground",
        className,
      )}
      title={m["engineLoad.hint"]({ memory, cpu: cpu ?? 0 })}
    >
      {memory}
    </span>
  );
}
