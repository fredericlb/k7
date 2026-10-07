// Gate.tsx — sign in, then show the library. One gate: the catalogue is served by this
// app's own backend, so there is no engine to find and no workspace to pick. The local
// cache the moteur plays from is a separate concern this screen never touches.

import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Loader2 } from "@frediverse/ui/icons";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
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
    <SignInScreen
      title="pl8"
      description="Les morceaux, les samples et les modules de studio, au même endroit."
      className="text-center"
    >
      <Button
        className="w-full"
        onClick={() => {
          window.location.href = auth.loginUrl;
        }}
      >
        <FrediverseMark size="sm" />
        Se connecter
      </Button>
    </SignInScreen>
  );
}
