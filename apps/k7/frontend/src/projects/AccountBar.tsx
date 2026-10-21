// AccountBar.tsx — the top of the home page. Where this machine runs its own backend (the tray's, a phone app's): the
// account's control and, signed in, the servers it syncs with (SyncServers.tsx); signed out, the machine's local user.
// On a server: the servers alone, this one first — the account's control is the user menu's. See ../../docs/localApp.md.

import { useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { AccountButton, type Me } from "../tabs/AccountButton";
import { AccountStatusNote } from "../tabs/AccountStatusNote";
import { useHasAccountControl } from "../tabs/bridge";
import { SyncServers } from "./SyncServers";

const BAR =
  "flex shrink-0 items-center gap-2 border-b px-6 py-2 text-muted-foreground text-xs";

export function AccountBar() {
  const [me, setMe] = useState<Me | null>(null);
  const shown = useHasAccountControl();
  const local = useLocalApp();
  // Still asking what serves the page: a bar drawn now might be the wrong one.
  if (local === undefined) return null;
  if (!shown)
    return (
      <div className={BAR}>
        <span className="min-w-0 flex-1">
          <SyncServers />
        </span>
        <AccountStatusNote />
      </div>
    );
  return (
    <div className={BAR}>
      <span className="min-w-0 flex-1">
        {/* Signed out: what that means here. Signed in: the servers its workspaces sync with. */}
        {me?.local ? m["home.signedOut"]() : me ? <SyncServers /> : null}
      </span>
      <AccountStatusNote />
      <AccountButton onUser={setMe} />
    </div>
  );
}
