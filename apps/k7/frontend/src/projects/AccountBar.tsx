// AccountBar.tsx — the top of the home page wherever this machine runs its own backend (the tray's, a phone app's): the
// account's control and, signed in, the servers it syncs with (SyncServers.tsx); signed out, what that means here — the
// machine's local user, whose workspaces are its own. Absent on a server. See ../../docs/localApp.md.

import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { AccountButton, type Me } from "../tabs/AccountButton";
import { AccountStatusNote } from "../tabs/AccountStatusNote";
import { useHasAccountBar } from "../tabs/bridge";
import { SyncServers } from "./SyncServers";

export function AccountBar() {
  const [me, setMe] = useState<Me | null>(null);
  const shown = useHasAccountBar();
  if (!shown) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2 text-muted-foreground text-xs">
      <span className="min-w-0 flex-1">
        {/* Signed out: what that means here. Signed in: the servers its workspaces sync with. */}
        {me?.local ? m["home.signedOut"]() : me ? <SyncServers /> : null}
      </span>
      <AccountStatusNote />
      <AccountButton onUser={setMe} />
    </div>
  );
}
