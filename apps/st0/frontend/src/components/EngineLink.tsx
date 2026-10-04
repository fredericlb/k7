// EngineLink — how the chosen engine is doing, drawn right of the header's engine switch: the
// connection light, the link's latency and the engine process's memory (docs/shell.md).
// The one thing a reader would get wrong: the latency is the SESSION's, not the engine's alone.

import { Circle } from "@frediverse/ui/icons";
import {
  type EngineLatency,
  formatLatency,
} from "@studio/web-protocol/quality";
import { m } from "../paraglide/messages.js";
import { EngineLoad } from "./EngineLoad";

export function EngineLink({
  connected,
  latency,
  compact,
}: {
  connected: boolean;
  latency: EngineLatency | null;
  /** A phone keeps the light and drops the figures, which the header has no room for. */
  compact?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
      <Circle
        className={`h-2.5 w-2.5 shrink-0 ${connected ? "fill-emerald-500 text-emerald-500" : "fill-red-500 text-red-500"}`}
        aria-label={connected ? "engine connected" : "engine disconnected"}
      />
      {!compact && (
        <>
          {/* Q1/Q2/Q3 off the measured latency, a property of the SESSION (@studio/web-protocol/quality). */}
          <span
            className="whitespace-nowrap font-mono text-[10px] tabular-nums"
            title={
              latency
                ? m["engines.latencyBreakdown"]({
                    network: Math.round(latency.networkMs),
                    audio: Math.round(latency.audioMs),
                  })
                : m["engines.noLatency"]()
            }
          >
            {latency ? formatLatency(latency) : m["engines.noLatency"]()}
          </span>
          <EngineLoad className="shrink-0" />
        </>
      )}
    </span>
  );
}
