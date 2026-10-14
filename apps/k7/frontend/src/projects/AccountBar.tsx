// AccountBar.tsx — the top of the home page in the desktop app: the account's control and, signed in, the servers
// it syncs with (SyncServers.tsx); signed out, what that means here — the machine's local user, whose workspaces are
// its own, the account's syncing on and back on sign-in. Absent on the hosted build. See apps/k7-standalone/docs/signIn.md.

import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { AccountButton, type Me } from "../tabs/AccountButton";
import { tabsBridge } from "../tabs/bridge";
import { SyncServers } from "./SyncServers";

export function AccountBar() {
  const [me, setMe] = useState<Me | null>(null);
  if (!tabsBridge()) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2 text-muted-foreground text-xs">
      <span className="min-w-0 flex-1">
        {/* Signed out: what that means here. Signed in: the servers its workspaces sync with. */}
        {me?.local ? m["home.signedOut"]() : me ? <SyncServers /> : null}
      </span>
      <AccountButton onUser={setMe} />
    </div>
  );
}
