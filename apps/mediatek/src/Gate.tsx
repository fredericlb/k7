// Gate.tsx — sign in, then find a reachable engine, then show the library. Deliberately
// smaller than lanes' three gates: there is no workspace to pick, and no engine LEASE —
// this app plays nothing, and claiming the "in use" badge would fight the DAW over an
// engine it isn't using. See docs/gate.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { probeEngines, type RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { backend, type ServiceLink } from "./api";
import { Library } from "./Library";

type Phase =
  | { k: "checking" }
  | { k: "anon" }
  | { k: "probing"; user: string }
  | { k: "no-engine"; user: string }
  | { k: "ready"; link: ServiceLink };

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
    {children}
  </div>
);

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });

  // Probe every registered engine and take the nearest that answered. Tier 3 means the
  // engine is registered but unreachable from this browser, which is not a usable link.
  const findEngine = useCallback(async (user: string) => {
    setPhase({ k: "probing", user });
    let ranked: RankedEngine<PublicEngine>[] = [];
    try {
      ranked = await probeEngines(await backend.engines());
    } catch {
      setPhase({ k: "no-engine", user });
      return;
    }
    const best = ranked.find((r) => r.fileBase && r.token !== null);
    if (!best) return setPhase({ k: "no-engine", user });
    setPhase({
      k: "ready",
      link: { base: best.fileBase!, user, token: best.token! },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let user: AuthUserEmail = null;
      try {
        const me = await backend.me();
        user = me?.email ?? null;
      } catch {
        user = null;
      }
      if (cancelled) return;
      // The file service identifies a caller by email — without one there is nothing to send.
      if (!user) return setPhase({ k: "anon" });
      await findEngine(user);
    })();
    return () => {
      cancelled = true;
    };
  }, [findEngine]);

  if (phase.k === "ready") return <Library link={phase.link} />;

  if (phase.k === "checking" || phase.k === "probing")
    return (
      <Centered>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {phase.k === "probing" ? "recherche d'un moteur…" : null}
        </div>
      </Centered>
    );

  if (phase.k === "no-engine")
    return (
      <Centered>
        <Card className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
          <div className="text-lg font-semibold">Aucun moteur joignable</div>
          <p className="text-sm text-muted-foreground">
            La médiathèque vit sur ta machine, à côté du moteur. Lance le capot,
            puis réessaie.
          </p>
          <Button
            variant="secondary"
            onClick={() => void findEngine(phase.user)}
          >
            <RefreshCw className="h-4 w-4" />
            Réessayer
          </Button>
        </Card>
      </Centered>
    );

  return (
    <Centered>
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <div className="text-2xl font-semibold tracking-tight">mediatek</div>
        <p className="text-sm text-muted-foreground">
          Les morceaux, les samples et les modules de studio, au même endroit.
        </p>
        <Button
          className="mt-2 w-full"
          onClick={() => {
            window.location.href = backend.loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          Se connecter
        </Button>
      </Card>
    </Centered>
  );
}

type AuthUserEmail = string | null;
