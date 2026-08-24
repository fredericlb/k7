// Gate.tsx — sign in, then pick the machine the project lives on. Two conditions before a
// third (ProjectShell): pl8 names the repository, and it has to be on that machine before
// anything opens. Same shape as st0's gate, and deliberately so — a second dialect of "which
// engine am I on" is how two apps end up disagreeing about one account.

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

const where = (r: RankedEngine<PublicEngine>): string =>
  r.latency ? formatLatency(r.latency) : "hors de portée";

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });

  const findEngine = useCallback(async () => {
    setPhase({ k: "looking" });
    const { ranked, chosen } = await engines.find();
    if (!chosen) return setPhase({ k: "picking", ranked });
    setPhase({ k: "ready", engine: chosen });
  }, []);

  const pick = useCallback((r: RankedEngine<PublicEngine>) => {
    // PATCH, never PUT: pl8's document has a second field, and a whole-body write erased it.
    void engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "ready", engine: r });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void auth
      .me()
      .then((u) => {
        if (cancelled) return;
        if (!u) return setPhase({ k: "anon" });
        void findEngine();
      })
      .catch(() => !cancelled && setPhase({ k: "anon" }));
    return () => {
      cancelled = true;
    };
  }, [findEngine]);

  if (phase.k === "ready")
    // Keyed on the engine, so switching machines rebuilds rather than reusing the old workspace.
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
          <p className="mb-4 max-w-xs text-sm text-muted-foreground">
            L'éditeur ouvre un dépôt de votre compte studio — pas une partie. La
            connexion est celle de la médiathèque, pas celle du jeu.
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
          Sur quelle machine sont les fichiers&nbsp;?
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          C'est elle qui tient la copie de travail du dépôt. Le choix reste sur
          votre compte.
        </p>
        {phase.ranked.length === 0 && (
          <p className="mb-4 text-xs text-muted-foreground">
            Aucun moteur ne s'est annoncé. Dans le capot :
            «&nbsp;Add&nbsp;web&nbsp;UI…&nbsp;».
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
          onClick={() => void findEngine()}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Rechercher à nouveau
        </Button>
      </Card>
    </div>
  );
}
