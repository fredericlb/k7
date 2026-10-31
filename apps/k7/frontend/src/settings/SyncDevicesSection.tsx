// SyncDevicesSection.tsx — the devices that sync this account with the hub this page is served by, each removable,
// and on a server a token minted for one that pairs by no browser. A machine's own saved servers are ServersSection's.
// See ../../docs/settings.md.

import { useCallback, useEffect, useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { onAndroid } from "./androidEngine";
import { NewDeviceToken } from "./NewDeviceToken";
import { Action, Row, Section } from "./Section";

interface Device {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
}

/** The tray's backend and the phone app's both run on the machine: a hub that pairs with an origin. */
const useLocal = (): boolean => !!useLocalApp() || onAndroid;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

const when = (ms?: number): string =>
  ms
    ? new Date(ms).toLocaleString(getLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export function SyncDevicesSection() {
  const local = useLocal();
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void json<{ devices: Device[] }>("/api/sync/devices")
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);

  useEffect(load, [load]);

  const act = (url: string) => {
    setBusy(true);
    setError(null);
    void json(url, { method: "DELETE" })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        load();
      });
  };

  if (local && devices.length === 0) return null;

  return (
    <Section title={m["syncdev.title"]()} hint={m["syncdev.hint"]()}>
      <Row label={m["syncdev.devices"]()} />
      {devices.length === 0 ? (
        <Row label={m["syncdev.noDevices"]()} />
      ) : (
        devices.map((d) => (
          <Row
            key={d.id}
            label={d.name}
            detail={m["syncdev.deviceDetail"]({
              paired: when(d.created),
              seen: when(d.lastSeen),
            })}
          >
            <Action
              danger
              disabled={busy}
              onClick={() =>
                act(`/api/sync/devices/${encodeURIComponent(d.id)}`)
              }
            >
              {m["syncdev.remove"]()}
            </Action>
          </Row>
        ))
      )}
      {!local && <NewDeviceToken onCreated={load} />}
      {error && <Row label={m["syncdev.failed"]({ error })} />}
    </Section>
  );
}
