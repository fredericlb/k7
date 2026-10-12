// SignedOutNotice.tsx — in the desktop app, signed out: this is the machine's local user, whose workspaces are
// its own, so the account's are not listed here. They are not gone: they keep syncing, and come back on sign-in.
// See apps/st0-standalone/docs/sync.md.

import { Button } from "@frediverse/ui/button";
import { LogIn } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { tabsBridge } from "../tabs/bridge";

export function SignedOutNotice() {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    if (!tabsBridge()) return;
    let live = true;
    void fetch("/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { user?: { local?: boolean } } | null) => {
        if (live) setLocal(b?.user?.local === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!local) return null;
  return (
    <div className="flex items-center gap-2 border-b px-6 py-3 text-muted-foreground text-xs">
      <span className="flex-1">{m["home.signedOut"]()}</span>
      <Button variant="ghost" size="sm" onClick={() => tabsBridge()?.signIn()}>
        <LogIn className="h-3.5 w-3.5" /> {m["home.signIn"]()}
      </Button>
    </div>
  );
}
