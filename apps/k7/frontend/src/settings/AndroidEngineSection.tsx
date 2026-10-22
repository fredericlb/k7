// AndroidEngineSection.tsx — this phone's engine, drawn only inside a phone app, Android or iOS: there the app IS the
// engine's machine, so what the command-line engine keeps in its config file — the studios it is listed at,
// the instruments it downloads, a private CA — and quitting belong on this panel. The app shows its own tray only while no studio is open.
// See ../../docs/settings.md, engine/k7-runtime/docs/android.md and docs/ios.md.

import { Switch } from "@frediverse/ui/switch";
import { studioFamily } from "@studio/web-protocol/services";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import {
  type EngineSnapshot,
  engineCall,
  onAndroid,
  onIos,
  useEngineSnapshot,
} from "./androidEngine";
import { InstrumentsSection } from "./InstrumentsSection";
import { Action, Row, Section } from "./Section";
import { StudiosSection } from "./StudiosSection";

export function AndroidEngineSection() {
  const snapshot = useEngineSnapshot();
  const [lan, setLan] = useState<string | null>(null);

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

      <Section title={m["engine.lanTitle"]()} hint={m["engine.lanHint"]()}>
        <Row
          label={m["engine.lanOpen"]()}
          detail={
            state?.lanOpen ? m["engine.lanOpenOn"]() : m["engine.lanOpenOff"]()
          }
        >
          <Switch
            checked={state?.lanOpen ?? false}
            disabled={!state}
            onCheckedChange={(on) =>
              void engineCall("command", {
                cmd: "lan.open",
                arg: on ? "1" : "0",
              })
            }
            aria-label={m["engine.lanOpen"]()}
          />
        </Row>
      </Section>

      <StudiosSection
        rows={rows}
        check={check}
        add={(url) =>
          void engineCall("command", { cmd: "weburi.add", arg: url })
        }
        remove={(url) =>
          void engineCall("command", { cmd: "weburi.remove", arg: url })
        }
        detail={(row) =>
          studioFamily(row.url) === snapshot?.studio
            ? m["android.openHere"]()
            : undefined
        }
        extra={(row) =>
          studioFamily(row.url) !== snapshot?.studio && (
            <Action
              onClick={() =>
                void engineCall("chooseStudio", {
                  origin: studioFamily(row.url),
                })
              }
              title={m["android.openStudio"]()}
            >
              {m["android.open"]()}
            </Action>
          )
        }
      />

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
    <Section
      title={m["android.caTitle"]()}
      hint={onIos ? m["android.caHintIos"]() : m["android.caHint"]()}
    >
      <Row
        label={
          count == null || count === 0
            ? onIos
              ? m["android.caSystemIos"]()
              : m["android.caSystem"]()
            : onIos
              ? m["android.caYoursIos"]({ count })
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
