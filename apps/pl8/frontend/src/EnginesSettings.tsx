// EnginesSettings.tsx — the settings screen's « Moteurs » card: every engine registered with
// this pl8, which is THE registry — st0 and z0 list theirs from here too. Read-only: an engine
// is connected from its own machine's tray, never from here. See ../docs/settings.md.

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

interface Looked {
  ranked: RankedEngine<PublicEngine>[];
  rememberedId: string | undefined;
}

/** Who holds it, said in full: « occupé » alone is a row people retry — packages/web-protocol/docs/machine.md. */
function heldLine(e: PublicEngine): string | null {
  if (!e.assigned) return null;
  const who = e.heldBy || "quelqu'un";
  return e.heldProject
    ? `utilisé par ${who} · ${e.heldProject}`
    : `utilisé par ${who}`;
}

function EngineRow({
  r,
  remembered,
}: {
  r: RankedEngine<PublicEngine>;
  remembered: boolean;
}) {
  const e = r.engine;
  const held = heldLine(e);
  return (
    <li className="flex items-start gap-3 rounded-md border px-3 py-2">
      <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{e.hostname || "—"}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {e.id.slice(0, 8)}
          </span>
          {remembered && <Badge>choisi</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {/* Measured from THIS browser: registered is not the same as reachable from here. */}
          {r.latency ? (
            <span className="text-emerald-500">{formatLatency(r.latency)}</span>
          ) : (
            <span className="text-destructive">
              injoignable depuis ce navigateur
            </span>
          )}
          {e.performance && (
            <span title={describePerformance(e.performance)}>
              {` · ${formatPerformance(e.performance)}`}
            </span>
          )}
          {e.sameSourceIp && " · même réseau"}
          {held && ` · ${held}`}
        </div>
      </div>
    </li>
  );
}

export function EnginesSettings() {
  const [looked, setLooked] = useState<Looked | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(async () => {
    setBusy(true);
    try {
      // `find` lists AND measures; a registry that does not answer reads as none, which is what it is from here.
      const { ranked, rememberedId } = await engines.find();
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
          <h3 className="font-semibold">Moteurs</h3>
          <p className="text-xs text-muted-foreground">
            Les moteurs enregistrés auprès de cette instance — les mêmes que st0
            propose.
          </p>
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
          Actualiser
        </Button>
      </div>

      {looked === null ? (
        <p className="text-sm text-muted-foreground">Recherche…</p>
      ) : ranked.length === 0 ? (
        // Says how to fix it, not just that it is empty: the answer lives on the engine's machine.
        <p className="text-sm text-muted-foreground">
          Aucun moteur enregistré. Sur la machine du moteur, ajoutez{" "}
          <span className="font-mono">{window.location.origin}</span> dans le
          capot : Settings… ▸ st0 instances.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranked.map((r) => (
            <EngineRow
              key={r.engine.id}
              r={r}
              remembered={r.engine.id === looked.rememberedId}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
