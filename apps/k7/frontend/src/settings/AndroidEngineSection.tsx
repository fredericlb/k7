// AndroidEngineSection.tsx — this phone's engine, drawn only inside the Android app: there the app IS the
// engine's machine, so what the command-line engine keeps in its config file — the studios it is listed at,
// the instruments it downloads, a private CA — and quitting belong on this panel. The app shows its own tray only while no studio is open.
// See ../../docs/settings.md and engine/k7-runtime/docs/android.md.

import { studioFamily } from "@studio/web-protocol/services";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import {
  type EngineSnapshot,
  engineCall,
  onAndroid,
  useEngineSnapshot,
} from "./androidEngine";
import { InstrumentsSection } from "./InstrumentsSection";
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
      <Section title={m["android.title"]()} hint={m["android.hint"]()}>
        <Row
          label={engineLine(snapshot, lan)}
          detail={
            rows.length > 0 && snapshot?.engineExit == null
              ? state?.lastHeartbeatOk
                ? m["android.listed"]()
                : m["android.notAnswering"]()
              : undefined
          }
        >
          <Action danger onClick={() => void engineCall("quit")}>
            {m["android.quit"]()}
          </Action>
        </Row>
      </Section>

      <Section title={m["android.studios"]()} hint={m["android.studiosHint"]()}>
        {rows.map((row) => {
          const family = studioFamily(row.url);
          const open = family === snapshot?.studio;
          return (
            <Row
              key={row.url}
              label={row.url}
              detail={open ? m["android.openHere"]() : undefined}
            >
              {!open && (
                <Action
                  onClick={() =>
                    void engineCall("chooseStudio", { origin: family })
                  }
                  title={m["android.openStudio"]()}
                >
                  {m["android.open"]()}
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
                  {m["ai.remove"]()}
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
            {m["android.connect"]()}
          </Action>
        </form>
        {check?.state === "checking" && (
          <p className="px-4 py-2 text-neutral-500 text-xs">
            {m["android.checking"]({ url: check.url ?? "" })}
          </p>
        )}
        {check?.state === "refused" && (
          <p className="px-4 py-2 text-red-300 text-xs">{check.message}</p>
        )}
      </Section>

      <InstrumentsSection
        snapshot={state ?? null}
        send={(cmd, name) => void engineCall("command", { cmd, arg: name })}
      />

      <PrivateCaSection />
    </>
  );
}

function engineLine(snapshot: EngineSnapshot | null, lan: string | null) {
  const state = snapshot?.state;
  if (snapshot?.engineExit != null)
    return m["android.engineStopped"]({ code: String(snapshot.engineExit) });
  if (!state) return m["android.starting"]();
  if (state.status === "running")
    return m["android.engineRunning"]({
      address: `ws://${lan ?? "127.0.0.1"}:${state.enginePort}`,
    });
  if (state.status === "error")
    return m["android.engineError"]({ message: String(state.error) });
  if (!state.status) return m["android.starting"]();
  return m["android.engineStatus"]({ status: state.status });
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
    setSaid(m["android.reconnecting"]({ doing }));
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
    <Section title={m["android.caTitle"]()} hint={m["android.caHint"]()}>
      <Row
        label={
          count == null || count === 0
            ? m["android.caSystem"]()
            : m["android.caYours"]({ count })
        }
        detail={said ?? undefined}
      >
        <Action
          disabled={busy}
          onClick={() => void run("importCa", m["android.caAdding"]())}
        >
          {m["android.caTrust"]()}
        </Action>
        <Action
          danger
          disabled={busy || !count}
          onClick={() => void run("forgetCas", m["android.caForgetting"]())}
        >
          {m["android.caForget"]()}
        </Action>
      </Row>
    </Section>
  );
}
