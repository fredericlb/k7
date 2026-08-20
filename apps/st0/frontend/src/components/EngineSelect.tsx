// EngineSelect.tsx — pick the engine to drive, FASTEST FIRST. The latency comes from actually
// reaching the engine (@studio/engine-browser/probe): the round trip plus what its audio
// interface costs. A row that answered is genuinely connectable; one that did not is shown for
// awareness and can't be selected.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import type { EngineQuality } from "@studio/web-protocol/quality";
import { formatLatency } from "@studio/web-protocol/quality";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";

/** Q1 plays, Q2 works, Q3 is for listening — so the badge reads green, plain, amber. */
const QUALITY_VARIANT: Record<EngineQuality, "tag" | "default" | "amber"> = {
  Q1: "tag",
  Q2: "default",
  Q3: "amber",
};

export function EngineSelect({
  ranked,
  loading,
  onRefresh,
  onPick,
}: {
  ranked: RankedEngine[];
  loading: boolean;
  onRefresh: () => void;
  onPick: (r: RankedEngine) => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Server className="h-5 w-5" /> {m["engines.title"]()}
          </h1>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw
              className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            {m["common.refresh"]()}
          </Button>
        </div>

        {ranked.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {m["engines.searching"]()}
              </span>
            ) : (
              <>
                No engines found. Start the{" "}
                <code className="rounded bg-secondary px-1">st0 engine</code>{" "}
                tray app, then Refresh.
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {ranked.map((r) => {
              const selectable = !!r.latency && !r.engine.assigned && !!r.wsUrl;
              return (
                <li
                  key={r.engine.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {r.engine.hostname || r.engine.id.slice(0, 8)}
                      </span>
                      {r.latency ? (
                        <Badge
                          variant={QUALITY_VARIANT[r.latency.quality]}
                          title={m["engines.latencyBreakdown"]({
                            network: Math.round(r.latency.networkMs),
                            audio: Math.round(r.latency.audioMs),
                          })}
                        >
                          {formatLatency(r.latency)}
                        </Badge>
                      ) : (
                        <Badge variant="amber">
                          {m["engines.unreachable"]()}
                        </Badge>
                      )}
                      {r.engine.assigned && (
                        <Badge variant="amber">in use</Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.wsUrl ?? "not reachable from this browser"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!selectable}
                    onClick={() => onPick(r)}
                  >
                    Use
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
