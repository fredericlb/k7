// EngineLink — how the chosen engine is doing, drawn in the project bar beside its engine: the
// connection light, the link's latency and the engine process's memory (docs/shell.md).
// The one thing a reader would get wrong: the latency is the SESSION's, not the engine's alone.

import { Circle, Unplug } from "@frediverse/ui/icons";
import {
  type EngineLatency,
  formatLatency,
} from "@studio/web-protocol/quality";
import { m } from "../paraglide/messages.js";
import { EngineLoad } from "./EngineLoad";

export function EngineLink({
  connected,
  latency,
}: {
  connected: boolean;
  latency: EngineLatency | null;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
      {/* A SHAPE as well as a colour: an unplugged plug reads without telling red from green. */}
      {connected ? (
        <span title={m["engine.linkUp"]()} className="flex shrink-0">
          <Circle
            className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500"
            role="img"
            aria-label={m["engine.linkUp"]()}
          />
        </span>
      ) : (
        <span title={m["engine.linkDown"]()} className="flex shrink-0">
          <Unplug
            className="h-3 w-3 text-red-500"
            role="img"
            aria-label={m["engine.linkDown"]()}
          />
        </span>
      )}
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
    </span>
  );
}
