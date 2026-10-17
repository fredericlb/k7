// EngineSelect.tsx — pick the engine to drive, FASTEST FIRST. The latency comes from actually
// reaching the engine (@studio/engine-browser/probe): the round trip plus what its audio
// interface costs. A row that answered is genuinely connectable; one that did not is shown for
// awareness and can't be selected.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Loader2, RefreshCw, Server } from "@frediverse/ui/icons";
import {
  describePerformance,
  formatPerformance,
} from "@studio/web-protocol/performance";
import type { EngineQuality } from "@studio/web-protocol/quality";
import { formatLatency } from "@studio/web-protocol/quality";
import { needingPairing, PairThisDevice } from "../pairing/PairThisDevice";
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
  onPaired,
  onBack,
}: {
  ranked: RankedEngine[];
  loading: boolean;
  onRefresh: () => void;
  onPick: (r: RankedEngine) => void;
  /** This device just paired with that engine: re-probe, and it answers as usable. */
  onPaired: (engineId: string) => void;
  /** Leave for the projects page — the way out when no engine can be had. */
  onBack: () => void;
}) {
  // The pairing card only while nothing is usable: with an engine to pick, pairing another is not this screen's business.
  const pairable = ranked.some(selectableRow) ? [] : needingPairing(ranked);
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Server className="h-5 w-5" /> {m["engines.title"]()}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              {m["project.backToProjects"]()}
            </Button>
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
        </div>

        {pairable.map((r) => (
          <PairThisDevice
            key={r.engine.id}
            engine={r}
            onPaired={() => onPaired(r.engine.id)}
          />
        ))}

        {ranked.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {m["engines.searching"]()}
              </span>
            ) : (
              m["engines.none"]()
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {ranked.map((r) => {
              const selectable = selectableRow(r);
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
                      {r.engine.performance && (
                        <Badge
                          variant="default"
                          title={describePerformance(r.engine.performance)}
                        >
                          {formatPerformance(r.engine.performance)}
                        </Badge>
                      )}
                      {r.engine.assigned && (
                        <Badge variant="amber" title={m["engines.inUseHint"]()}>
                          {m["engines.inUse"]()}
                        </Badge>
                      )}
                      {r.engine.outdated && (
                        <Badge
                          variant="amber"
                          title={m["engines.outdatedHint"]()}
                        >
                          {m["engines.outdated"]()}
                        </Badge>
                      )}
                      {r.engine.safeMode && (
                        <Badge
                          variant="amber"
                          title={m["engines.safeModeHint"]()}
                        >
                          {m["engines.safeMode"]()}
                        </Badge>
                      )}
                      {accessText(r.engine) && (
                        <Badge
                          variant={
                            r.engine.access === "unowned" ? "amber" : "default"
                          }
                          title={
                            r.engine.access === "unowned"
                              ? m["media.engines.unownedHint"]()
                              : undefined
                          }
                        >
                          {accessText(r.engine)}
                        </Badge>
                      )}
                    </div>
                    {/* The socket URL is never shown: it can carry a signed ticket, and the latency badge already says the link works. */}
                    {!r.wsUrl && (
                      <div className="truncate text-xs text-muted-foreground">
                        {m["engines.noRoute"]()}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={!selectable}
                    onClick={() => onPick(r)}
                  >
                    {m["engines.use"]()}
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

/** What this account is to the engine, said as the settings card says it — engine-registry docs/ownership.md. */
function accessText(e: RankedEngine["engine"]): string | null {
  switch (e.access) {
    case "owner":
      return m["media.engines.yours"]();
    case "shared":
      return m["media.engines.sharedBy"]({
        owner: e.ownedBy || m["media.engines.someone"](),
      });
    case "server":
      return m["media.engines.server"]();
    case "unowned":
      return m["media.engines.unowned"]();
    default:
      return null;
  }
}

/** Answered, free, not waiting to pair this device, and not too old for this server. */
function selectableRow(r: RankedEngine): boolean {
  return (
    !!r.latency &&
    !r.engine.assigned &&
    !!r.wsUrl &&
    !r.needsPairing &&
    !r.engine.outdated
  );
}
