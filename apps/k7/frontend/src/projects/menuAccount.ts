// menuAccount.ts — the user menu's heading. On a server, who is signed in there; on a machine (the tray, a phone app),
// the account on the ACTIVE server, or "Local" with none: the machine's own user is not anyone's login.
// See ../../docs/localApp.md.

import { useEffect, useState } from "react";
import { api } from "../api";
import { localApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { savedServersCall } from "../settings/savedServers";

async function heading(): Promise<string | null> {
  if (await localApp()) {
    const servers = await savedServersCall("GET").catch(() => []);
    return servers.find((s) => s.active)?.as ?? m["home.localUser"]();
  }
  const u = await api.getMe();
  return u?.email || u?.name || u?.sub || null;
}

/** The heading, null until known: AuthGate asked who is signed in already, but hands nothing down. */
export function useMenuAccount(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void heading()
      .then((n) => live && setName(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return name;
}
