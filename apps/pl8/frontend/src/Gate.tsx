// Gate.tsx — sign in, then show the library. One gate: the catalogue is served by this
// app's own backend, so there is no engine to find and no workspace to pick. The local
// cache the moteur plays from is a separate concern this screen never touches.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { auth } from "./api";
import { Library } from "./Library";

type Phase = { k: "checking" } | { k: "anon" } | { k: "authed" };

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });

  useEffect(() => {
    let cancelled = false;
    auth
      .me()
      .then((u) => !cancelled && setPhase(u ? { k: "authed" } : { k: "anon" }))
      .catch(() => !cancelled && setPhase({ k: "anon" }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.k === "authed") return <Library />;

  if (phase.k === "checking")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <div className="text-2xl font-semibold tracking-tight">pl8</div>
        <p className="text-sm text-muted-foreground">
          Les morceaux, les samples et les modules de studio, au même endroit.
        </p>
        <Button
          className="mt-2 w-full"
          onClick={() => {
            window.location.href = auth.loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          Se connecter
        </Button>
      </Card>
    </div>
  );
}
