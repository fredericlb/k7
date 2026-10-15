// Pairing.tsx — the LAN devices asking to drive this phone's engine, and those it trusts: the same lists and
// commands as k7's Paired devices section (apps/k7/frontend/src/settings/PairedDevicesSection.tsx). Approve only when the code
// matches the device's screen — anyone on the network can ask under any name.

import { Button } from "@frediverse/ui/button";
import { K7Runtime, type PairedDevice, type PairRequest } from "./native";

export interface PairingProps {
  requests: PairRequest[];
  devices: PairedDevice[];
}

export function Pairing({ requests, devices }: PairingProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Paired devices</h2>
      {requests.map((r) => (
        <div key={r.requestId} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{r.name || "unnamed device"}</p>
            <p className="text-lg tabular-nums tracking-widest">{r.code}</p>
            <p className="text-xs text-muted-foreground">from {r.ip}</p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              K7Runtime.command({ cmd: "pair.approve", arg: r.requestId })
            }
          >
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              K7Runtime.command({ cmd: "pair.deny", arg: r.requestId })
            }
          >
            Deny
          </Button>
        </div>
      ))}
      {devices.length === 0 && requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          none — a browser on this network asks to pair, and you approve it here
        </p>
      ) : null}
      {devices.map((d) => (
        <div key={d.deviceId} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{d.name || "unnamed device"}</p>
            <p className="text-xs text-muted-foreground">
              last seen{" "}
              {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "never"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              K7Runtime.command({ cmd: "pair.revoke", arg: d.deviceId })
            }
          >
            Revoke
          </Button>
        </div>
      ))}
    </section>
  );
}
