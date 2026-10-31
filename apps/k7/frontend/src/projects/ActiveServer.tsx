// ActiveServer.tsx — the account bar's word on the remote, on a machine: the ACTIVE server as `host · account`, or
// none, either one a link to the settings where servers are added and switched. See ../../docs/localApp.md.

import { Cloud, CloudOff } from "@frediverse/ui/icons";
import { Link } from "react-router-dom";
import { m } from "../paraglide/messages.js";
import { serverLabel, useSavedServers } from "../settings/savedServers";
import { SETTINGS_ROUTE } from "./api";

export function ActiveServer() {
  const { servers } = useSavedServers();
  if (servers === null) return null;
  const [active] = servers;
  const Icon = active ? Cloud : CloudOff;
  return (
    <Link
      to={`${SETTINGS_ROUTE}?tab=devices`}
      className="flex min-w-0 items-center gap-1.5 rounded px-1 hover:text-foreground"
      title={m["account.manageServers"]()}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">
        {active
          ? m["account.activeServer"]({ server: serverLabel(active) })
          : m["account.noServer"]()}
      </span>
    </Link>
  );
}
