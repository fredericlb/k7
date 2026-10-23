// EnginesSettings.tsx — the settings screen's Engines card: the engines registered with this
// origin that this ACCOUNT may use — its own, those shared with it, the server's — and the unowned
// ones this browser might enrol. An engine is connected from its own machine, never from here; its
// owner shares it or gives it up here. See ../docs/settings.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Loader2, RefreshCw, Server } from "@frediverse/ui/icons";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import {
  describePerformance,
  formatPerformance,
} from "@studio/web-protocol/performance";
import { formatLatency } from "@studio/web-protocol/quality";
import { useCallback, useEffect, useState } from "react";
import { engines } from "./api";
import { EngineShareEditor } from "./EngineShareEditor";
import { accessLabel } from "./engineShares";
import { useLabels } from "./host";
import type { LibraryLabels } from "./labels";

interface Looked {
  ranked: RankedEngine<PublicEngine>[];
  rememberedId: string | undefined;
}

/** Who holds it, said in full: "busy" alone is a row people retry — packages/web-protocol/docs/machine.md. */
function heldLine(e: PublicEngine, l: LibraryLabels["engines"]): string | null {
  if (!e.assigned) return null;
  const by = l.heldBy(e.heldBy || l.someone);
  return e.heldProject ? `${by} · ${e.heldProject}` : by;
}

function EngineRow({
  r,
  remembered,
  onChanged,
}: {
  r: RankedEngine<PublicEngine>;
  remembered: boolean;
  onChanged: () => void;
}) {
  const l = useLabels().engines;
  const e = r.engine;
  const held = heldLine(e, l);
  const access = accessLabel(e, l);
  return (
    <li className="flex items-start gap-3 rounded-md border px-3 py-2">
      <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{e.hostname || "—"}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {e.id.slice(0, 8)}
          </span>
          {access && (
            <Badge
              variant={e.access === "unowned" ? "amber" : "default"}
              title={e.access === "unowned" ? l.unownedHint : undefined}
            >
              {access}
            </Badge>
          )}
          {e.server && e.access === "owner" && <Badge>{l.server}</Badge>}
          {remembered && <Badge>{l.chosen}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {/* Measured from THIS browser: registered is not the same as reachable from here. */}
          {r.latency ? (
            <span className="text-emerald-500">{formatLatency(r.latency)}</span>
          ) : (
            <span className="text-destructive">{l.unreachable}</span>
          )}
          {e.performance && (
            <span title={describePerformance(e.performance)}>
              {` · ${formatPerformance(e.performance)}`}
            </span>
          )}
          {e.sameSourceIp && ` · ${l.sameNetwork}`}
          {held && ` · ${held}`}
        </div>
        {/* The server's engine is every account's to use: its admins own it with nothing to share or give up. */}
        {e.access === "owner" && !e.server && (
          <EngineShareEditor id={e.id} onGivenUp={onChanged} />
        )}
      </div>
    </li>
  );
}

export function EnginesSettings() {
  const l = useLabels().engines;
  const [looked, setLooked] = useState<Looked | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(async () => {
    setBusy(true);
    try {
      // `find` lists AND measures; a registry that does not answer reads as none, which is what it is from here.
      const { ranked, rememberedId } = await engines().find();
      setLooked({ ranked, rememberedId });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void look();
  }, [look]);

  const ranked = looked?.ranked ?? [];
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{l.title}</h3>
          <p className="text-xs text-muted-foreground">{l.hint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void look()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {l.refresh}
        </Button>
      </div>

      {looked === null ? (
        <p className="text-sm text-muted-foreground">{l.looking}</p>
      ) : ranked.length === 0 ? (
        // Says how to fix it, not just that it is empty: the answer lives on the engine's machine.
        <p className="text-sm text-muted-foreground">
          {l.none(window.location.origin)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranked.map((r) => (
            <EngineRow
              key={r.engine.id}
              r={r}
              remembered={r.engine.id === looked.rememberedId}
              onChanged={() => void look()}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
