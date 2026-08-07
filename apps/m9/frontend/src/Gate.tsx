// Gate.tsx — sign in, then pick the machine you work on. Two gates and not one: the engine is
// remembered on the account, so the login has to happen first for there to be an account to
// remember it on. A THIRD gate follows (ProjectShell): st0 names the repository, and it has to
// be on that machine before anything opens.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import { useRelook } from "@studio/engine-browser/relook";
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

/** How good the link is, measured: the round trip plus what its interface costs. Null when
 *  nothing answered — listed by the registry, out of reach from this browser. */
function where(r: RankedEngine<PublicEngine>): string {
  return r.latency ? formatLatency(r.latency) : "hors de portée";
}

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });

  const findEngine = useCallback(async () => {
    setPhase({ k: "looking" });
    const { ranked, chosen } = await engines.find();
    // No engine at all still shows the picker, unlike the médiathèque: an editor without an
    // engine still edits text, but a deck without one has nothing to do — so the screen that
    // explains why is the right one to be on.
    if (!chosen) return setPhase({ k: "picking", ranked });
    setPhase({ k: "ready", engine: chosen });
  }, []);

  /**
   * La liste se re-mesure toute seule tant que le sélecteur est à l'écran — même raison que
   * dans l8 : `unreachable` est un état à part, pas une latence lente, et une seule course
   * ratée le figeait jusqu'au rechargement.
   *
   * Elle ne fait que remplacer la LISTE : un moteur qui répond de nouveau ne fait pas sauter
   * l'écran, parce que quelqu'un est en train de choisir et qu'une décision prise à sa place
   * serait un clic volé.
   */
  const relook = useRelook();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `relook` est un déclencheur, pas une valeur lue ici — il dit QUAND re-mesurer.
  useEffect(() => {
    if (phase.k !== "picking") return;
    let cancelled = false;
    void engines
      .find()
      .then(({ ranked }) => {
        if (!cancelled) setPhase({ k: "picking", ranked });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [relook, phase.k]);

  const pick = useCallback((r: RankedEngine<PublicEngine>) => {
    // Remembered before connecting, and the failure is quiet: a save that did not land
    // costs the choice surviving the session, not the set that is about to start.
    // `patchPrefs` even though m9's document holds only this field today: the verb that cannot
    // erase a neighbour is the one to reach for by default, and the day a second field lands
    // nobody has to remember this line exists.
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
    // Keyed on the engine: switching machines rebuilds everything rather than reusing a
    // socket, a workspace and a cache root that belong to the old one.
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
            m9, c'est votre compte : la machine que vous choisissez y reste
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
          Sur quelle machine jouez-vous&nbsp;?
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          C'est elle qui tient la carte son et le cache de la médiathèque. Le
          choix reste sur votre compte.
        </p>
        {phase.ranked.length === 0 && (
          // Not an error: each service holds its own registry, so an engine appears here
          // only once its capot has been pointed at m9.
          <p className="mb-4 text-xs text-muted-foreground">
            Aucun moteur ne s'est annoncé à m9. Dans le capot : «&nbsp;Add web
            UI…&nbsp;».
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
