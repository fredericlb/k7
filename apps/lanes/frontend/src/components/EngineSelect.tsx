// EngineSelect.tsx — pick the engine to drive, ordered by how close it is. The tier comes
// from actually reaching the engine (engineProbe.ts), so a Tier-1/2 row is genuinely
// connectable; a Tier-3 row is shown for awareness but can't be selected yet.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Loader2, RefreshCw, Server } from "lucide-react";
import type { RankedEngine } from "../engineProbe";
import { m } from "../paraglide/messages.js";

const TIER_LABEL: Record<number, () => string> = {
  1: m["engines.tier1"],
  2: m["engines.tier2"],
  3: m["engines.tier3"],
};
const TIER_VARIANT: Record<number, "tag" | "default" | "amber"> = {
  1: "tag",
  2: "default",
  3: "amber",
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
                <code className="rounded bg-secondary px-1">lanes engine</code>{" "}
                tray app, then Refresh.
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {ranked.map((r) => {
              const selectable = r.tier < 3 && !r.engine.assigned && !!r.wsUrl;
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
                      <Badge variant={TIER_VARIANT[r.tier]}>
                        {TIER_LABEL[r.tier]?.()}
                      </Badge>
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
