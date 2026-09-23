// AuthGate.tsx — the OUTERMOST gate: the user must be signed in (the shared frediverse
// OIDC flow) before anything else mounts, since the engine chooser and the file API are
// session-protected and would 401 for an anonymous tab. With no OIDC_* configured the
// backend runs a dev stub, so "Sign in" logs you in as a single Dev User — still mandatory.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Loader2 } from "@frediverse/ui/icons";
import { type ReactNode, useEffect, useState } from "react";
import { type AuthUser, api } from "../api";
import { m } from "../paraglide/messages.js";
import { LocaleSwitcher } from "./LocaleSwitcher";

// `down` is NOT `anon`: getMe answers null for a 401 and THROWS for anything else, so the two are known apart.
type Phase =
  | { k: "checking" }
  | { k: "anon" }
  | { k: "down"; detail: string }
  | { k: "authed"; user: AuthUser };

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ k: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((user) => {
        if (cancelled) return;
        setPhase(user ? { k: "authed", user } : { k: "anon" });
      })
      .catch(
        (e: Error) =>
          !cancelled && setPhase({ k: "down", detail: e.message ?? String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (phase.k === "authed") return <>{children}</>;

  if (phase.k === "checking")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  // Signing in cannot help when the service that mints the session is the thing that is down.
  if (phase.k === "down")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
          <div className="text-2xl font-semibold tracking-tight">st0</div>
          <p className="text-sm text-muted-foreground">
            {m["auth.unreachable"]()}
          </p>
          <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {phase.detail}
          </code>
          <Button
            className="mt-2 w-full"
            onClick={() => {
              setPhase({ k: "checking" });
              setAttempt((n) => n + 1);
            }}
          >
            {m["auth.retry"]()}
          </Button>
          <LocaleSwitcher />
        </Card>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <div className="text-2xl font-semibold tracking-tight">st0</div>
        <p className="text-sm text-muted-foreground">{m["auth.tagline"]()}</p>
        <Button
          className="mt-2 w-full"
          onClick={() => {
            window.location.href = api.loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          {m["auth.signIn"]()}
        </Button>
        <LocaleSwitcher />
      </Card>
    </div>
  );
}
