// SyncDevicesSection.tsx — live sync's pairings, from both ends: on the desktop or the phone, whether this
// machine syncs the account with an origin and the Unpair that stops it; on the origin, the account's
// devices, each removable. Both are session routes of the hub this page is served by. See ../../docs/settings.md.

import { useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { tabBridge } from "../tabs/bridge";
import { onAndroid } from "./androidEngine";
import { Action, Row, Section } from "./Section";

interface Remote {
  paired: boolean;
  url: string | null;
}

interface Device {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
}

interface Me {
  email?: string | null;
  name?: string;
  /** The desktop's signed-out user, which has no account at any origin. */
  local?: boolean;
}

/** The desktop app's views and the Android app's both run their own backend: a hub that pairs with an origin. */
const localApp = (): boolean => tabBridge() !== undefined || onAndroid;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

/** The origin a relay URL names, as a person reads it: `wss://st0.app/api/sync` → `st0.app`. */
const originOf = (url: string | null): string => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return url ?? "";
  }
};

const when = (ms?: number): string =>
  ms
    ? new Date(ms).toLocaleString(getLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export function SyncDevicesSection() {
  const local = localApp();
  const [me, setMe] = useState<Me | null>(null);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void json<{ user: Me }>("/auth/me")
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
    if (local)
      void json<Remote>("/api/sync/remote")
        .then(setRemote)
        .catch(() => setRemote(null));
    void json<{ devices: Device[] }>("/api/sync/devices")
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, [local]);

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

  const showMachine = local && remote !== null;
  const showDevices = !local || devices.length > 0;
  if (!showMachine && !showDevices) return null;
  const account = me?.email || me?.name || "";

  return (
    <Section title={m["syncdev.title"]()} hint={m["syncdev.hint"]()}>
      {showMachine &&
        (remote.paired && !me?.local ? (
          <Row
            label={m["syncdev.paired"]({
              account,
              origin: originOf(remote.url),
            })}
            detail={m["syncdev.pairedDetail"]()}
          >
            <Action
              danger
              disabled={busy}
              onClick={() => act("/api/sync/remote")}
            >
              {m["syncdev.unpair"]()}
            </Action>
          </Row>
        ) : (
          <Row label={m["syncdev.unpaired"]()} />
        ))}
      {showDevices && (
        <>
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
        </>
      )}
      {error && <Row label={m["syncdev.failed"]({ error })} />}
    </Section>
  );
}
