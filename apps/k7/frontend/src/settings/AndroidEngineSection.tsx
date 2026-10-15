// AndroidEngineSection.tsx — this phone's engine, drawn only inside the Android app: there the app IS the
// engine's machine, so what the command-line engine keeps in its config file — the studios it is listed at,
// a private CA — and quitting belong on this panel. The app shows its own tray only while no studio is open.
// See ../../docs/settings.md and engine/k7-runtime/docs/android.md.

import { studioFamily } from "@studio/web-protocol/services";
import { useEffect, useState } from "react";
import {
  type EngineSnapshot,
  engineCall,
  onAndroid,
  useEngineSnapshot,
} from "./androidEngine";
import { Action, Row, Section } from "./Section";

export function AndroidEngineSection() {
  const snapshot = useEngineSnapshot();
  const [lan, setLan] = useState<string | null>(null);
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (!onAndroid) return;
    void engineCall<{ address?: string }>("lanAddress").then((r) =>
      setLan(r.address ?? null),
    );
  }, []);

  if (!onAndroid) return null;
  const state = snapshot?.state;
  const rows = state?.instances ?? [];
  const check = state?.instanceCheck;

  const connect = () => {
    const url = address.trim();
    if (url) void engineCall("command", { cmd: "weburi.add", arg: url });
  };

  return (
    <>
      <Section
        title="This phone's engine"
        hint="It runs inside this app, and only while the app is on screen: leaving the app stops it and unlists it."
      >
        <Row
          label={engineLine(snapshot, lan)}
          detail={
            rows.length > 0 && snapshot?.engineExit == null
              ? state?.lastHeartbeatOk
                ? "Listed at every studio"
                : "A studio is not answering"
              : undefined
          }
        >
          <Action danger onClick={() => void engineCall("quit")}>
            Quit
          </Action>
        </Row>
      </Section>

      <Section
        title="Studios"
        hint="Where this phone's engine is listed. k7 opens on the one marked open."
      >
        {rows.map((row) => {
          const family = studioFamily(row.url);
          const open = family === snapshot?.studio;
          return (
            <Row
              key={row.url}
              label={row.url}
              detail={open ? "Open here" : undefined}
            >
              {!open && (
                <Action
                  onClick={() =>
                    void engineCall("chooseStudio", { origin: family })
                  }
                  title="Open k7 on this studio"
                >
                  Open
                </Action>
              )}
              {row.removable && (
                <Action
                  danger
                  onClick={() =>
                    void engineCall("command", {
                      cmd: "weburi.remove",
                      arg: row.url,
                    })
                  }
                >
                  Remove
                </Action>
              )}
            </Row>
          );
        })}
        <form
          className="flex items-center gap-2 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://studio.example"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm"
          />
          <Action onClick={connect} disabled={!address.trim()}>
            Connect
          </Action>
        </form>
        {check?.state === "checking" && (
          <p className="px-4 py-2 text-neutral-500 text-xs">
            Checking {check.url}…
          </p>
        )}
        {check?.state === "refused" && (
          <p className="px-4 py-2 text-red-300 text-xs">{check.message}</p>
        )}
      </Section>

      <PrivateCaSection />
    </>
  );
}

function engineLine(snapshot: EngineSnapshot | null, lan: string | null) {
  const state = snapshot?.state;
  if (snapshot?.engineExit != null)
    return `Engine stopped (${snapshot.engineExit})`;
  if (!state) return "Starting…";
  if (state.status === "running")
    return `Engine running on ws://${lan ?? "127.0.0.1"}:${state.enginePort}`;
  if (state.status === "error") return `Engine: ${state.error}`;
  return `Engine ${state.status ?? "starting…"}`;
}

// The supervisor reads its roots once, at start: each change restarts it, and it adopts the running engine.
function PrivateCaSection() {
  const [count, setCount] = useState<number | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void engineCall<{ count: number }>("casInfo").then((r) =>
      setCount(r.count),
    );
  }, []);

  const run = async (method: "importCa" | "forgetCas", doing: string) => {
    setBusy(true);
    setSaid(`${doing} — reconnecting…`);
    try {
      const done = await engineCall<{ count: number; said?: string }>(method);
      setCount(done.count);
      setSaid(done.said || null);
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Private CA"
      hint="Only for a studio whose HTTPS certificate is signed by a CA of your own. Android keeps the CAs installed in Settings out of an app's reach, so the certificate file (.pem, .crt or .der) is picked here; the engine and k7 both trust it."
    >
      <Row
        label={
          count == null || count === 0
            ? "Android's CAs only"
            : `Android's CAs and ${count} of yours`
        }
        detail={said ?? undefined}
      >
        <Action disabled={busy} onClick={() => void run("importCa", "Adding")}>
          Trust a certificate…
        </Action>
        <Action
          danger
          disabled={busy || !count}
          onClick={() => void run("forgetCas", "Forgetting")}
        >
          Forget
        </Action>
      </Row>
    </Section>
  );
}
