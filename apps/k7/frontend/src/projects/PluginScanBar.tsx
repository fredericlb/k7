// PluginScanBar.tsx — the home page's bottom bar while the account's engine scans its plugins: the
// one the policy would play on, else the one remembered, else the only one reachable. Nothing is
// claimed — the socket only listens. Gone when the scan ends or no engine reports one. See
// ../../docs/projects.md.

import { watchPluginScan } from "@studio/engine-browser/scan-watch";
import type { PluginScanStatus } from "@studio/engine-protocol/decode";
import { useEffect, useState } from "react";
import { engines } from "../api";
import { scanStep } from "../components/StartupBar";
import type { RankedEngine } from "../types";

/** The engine whose scan this page follows: chosen, remembered, or the only one that answered. */
export function scannedEngine(
  ranked: RankedEngine[],
  chosen: RankedEngine | null,
  rememberedId: string | undefined,
): RankedEngine | null {
  if (chosen?.wsUrl) return chosen;
  const reachable = ranked.filter((r) => r.wsUrl);
  return (
    reachable.find((r) => r.engine.id === rememberedId) ??
    (reachable.length === 1 ? reachable[0] : null)
  );
}

export function PluginScanBar() {
  const [scan, setScan] = useState<PluginScanStatus | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let live = true;
    void engines
      .find()
      .then(({ ranked, chosen, rememberedId }) => {
        const r = scannedEngine(ranked, chosen, rememberedId);
        if (live && r) stop = watchPluginScan(engines.linkUrl(r), setScan);
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  if (!scan?.scanning) return null;
  const step = scanStep(scan);
  return (
    <div role="status" aria-live="polite" className="text-xs">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={step.pct ?? undefined}
        className="h-0.5 w-full overflow-hidden bg-muted"
      >
        <div
          className={
            step.pct === null
              ? "h-full w-1/3 animate-pulse bg-primary"
              : "h-full bg-primary transition-all"
          }
          style={step.pct === null ? undefined : { width: `${step.pct}%` }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-1 text-muted-foreground">
        <span className="truncate">{step.label}</span>
        {scan.current && (
          <span className="truncate opacity-70">{scan.current}</span>
        )}
      </div>
    </div>
  );
}
