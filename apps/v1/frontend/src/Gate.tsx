// Gate.tsx — sign in, then pick the machine you work on. Two gates and not one: the machine is
// remembered on the account, so the login has to happen first for there to be an account to
// remember it on. A THIRD gate follows (ProjectShell): st0 names the repository, and it has to
// be on that machine before anything opens.
//
// It is a MACHINE that is being picked, not a sound card. v1 plays nothing — what it needs from
// the one you choose is its file service: the project's YAML, and the footage bytes.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { formatLatency } from "@studio/web-protocol/quality";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { auth, engines } from "./api";
import { ProjectShell } from "./ProjectShell";

type Phase =
  | { k: "checking" }
  | { k: "anon" }
  | { k: "looking" }
  | { k: "picking"; ranked: RankedEngine<PublicEngine>[] }
  | { k: "ready"; engine: RankedEngine<PublicEngine> };

/** How good the link is, measured. Null when nothing answered — listed by the registry, out of
 *  reach from this browser. */
function where(r: RankedEngine<PublicEngine>): string {
  return r.latency ? formatLatency(r.latency) : "hors de portée";
}

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });

  const findMachine = useCallback(async () => {
    setPhase({ k: "looking" });
    const { ranked, chosen } = await engines.find();
    // No machine at all still shows the picker: the screen that explains why is the right one
    // to be on, since a cut with no files to read has nothing to do.
    if (!chosen) return setPhase({ k: "picking", ranked });
    setPhase({ k: "ready", engine: chosen });
  }, []);

  const pick = useCallback((r: RankedEngine<PublicEngine>) => {
    // Remembered before connecting, and the failure is quiet: a save that did not land costs
    // the choice surviving the session, not the work about to start.
    void engines.savePrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "ready", engine: r });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void auth
      .me()
      .then((u) => {
        if (cancelled) return;
        if (!u) return setPhase({ k: "anon" });
        void findMachine();
      })
      .catch(() => !cancelled && setPhase({ k: "anon" }));
    return () => {
      cancelled = true;
    };
  }, [findMachine]);

  if (phase.k === "ready")
    // Keyed on the machine: switching rebuilds everything rather than reusing a workspace and a
    // media base that belong to the old one.
    return <ProjectShell key={phase.engine.engine.id} engine={phase.engine} />;

  if (phase.k === "checking" || phase.k === "looking")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  if (phase.k === "anon")
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Card className="p-6 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            v1, c'est votre compte : la machine que vous choisissez y reste
            associée.
          </p>
          <Button onClick={() => (window.location.href = auth.loginUrl)}>
            Se connecter
          </Button>
        </Card>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Card className="w-96 p-6">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Server className="h-4 w-4" />
          Sur quelle machine montez-vous&nbsp;?
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          C'est elle qui tient les rushes et le dépôt. Le choix reste sur votre
          compte.
        </p>
        {phase.ranked.length === 0 && (
          // Not an error: each service holds its own registry, so a machine appears here only
          // once its capot has been pointed at v1.
          <p className="mb-4 text-xs text-muted-foreground">
            Aucune machine ne s'est annoncée à v1. Dans le capot : «&nbsp;Add
            web UI…&nbsp;».
          </p>
        )}
        {phase.ranked.map((r) => (
          <button
            key={r.engine.id}
            type="button"
            disabled={!r.wsUrl}
            onClick={() => pick(r)}
            className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${
              r.wsUrl
                ? "hover:bg-accent/50"
                : "cursor-not-allowed text-muted-foreground/60"
            }`}
          >
            <span className="flex-1 truncate">{r.engine.hostname}</span>
            <span className="text-xs text-muted-foreground">{where(r)}</span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-xs"
          onClick={() => void findMachine()}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Rechercher à nouveau
        </Button>
      </Card>
    </div>
  );
}
