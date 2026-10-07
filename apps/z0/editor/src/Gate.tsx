// Gate.tsx — sign in, then pick the machine the project lives on. Two conditions before a
// third (ProjectShell): pl8 names the repository, and it has to be on that machine before
// anything opens. Same shape as st0's gate, and deliberately so — a second dialect of "which
// engine am I on" is how two apps end up disagreeing about one account.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Loader2, RefreshCw, Server } from "@frediverse/ui/icons";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { formatLatency } from "@studio/web-protocol/quality";
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
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  if (phase.k === "anon")
    return (
      <SignInScreen
        title="z0 — éditeur"
        description="L'éditeur ouvre un dépôt de votre compte studio — pas une partie. La connexion est celle de la médiathèque, pas celle du jeu."
        className="text-center"
      >
        <Button
          className="w-full"
          onClick={() => (window.location.href = auth.loginUrl)}
        >
          <FrediverseMark size="sm" />
          Se connecter
        </Button>
      </SignInScreen>
    );

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Card className="w-96">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Server className="size-4" />
            Sur quelle machine sont les fichiers&nbsp;?
          </CardTitle>
          <CardDescription className="text-xs">
            C'est elle qui tient la copie de travail du dépôt. Le choix reste
            sur votre compte.
          </CardDescription>
        </CardHeader>
        {phase.ranked.length === 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            Aucun moteur ne s'est annoncé. Dans le capot :
            «&nbsp;Add&nbsp;web&nbsp;UI…&nbsp;».
          </p>
        )}
        <div className="flex flex-col gap-1">
          {phase.ranked.map((r) => (
            <Button
              key={r.engine.id}
              variant="outline"
              disabled={!r.wsUrl}
              onClick={() => pick(r)}
              className="w-full justify-between font-normal"
            >
              <span className="truncate">{r.engine.hostname}</span>
              <Badge>{where(r)}</Badge>
            </Button>
          ))}
        </div>
        <CardFooter>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => void findEngine()}
          >
            <RefreshCw className="size-3.5" />
            Rechercher à nouveau
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
