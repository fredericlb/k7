// EnginePage.tsx — `/settings/engine`, the user menu's Engine. On the tray, this machine's engine under five tabs:
// Engine (whether it runs, which audio interface it takes first, whether its network may use it unpaired), Servers
// (where it is listed), Instruments, Plugins, and the engines this account may use. What the command-line engine
// reads from its config file; the tray hands its user no such file. Anywhere else, those engines alone, and the
// phone's own first. See ../../docs/settings.md.

import { ArrowDown, ArrowUp } from "@frediverse/ui/icons";
import { Switch } from "@frediverse/ui/switch";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeFrame";
import { PageFrame } from "../projects/PageFrame";
import { AccountStatusNote } from "../tabs/AccountStatusNote";
import { accountBridge } from "../tabs/bridge";
import {
  type DesktopEngineSnapshot,
  engineCommand,
  idleAsioDriver,
  moveDevice,
  rankedDevices,
  useDesktopEngine,
  useOnDesktopEngine,
} from "./desktopEngine";
import { InstrumentsSection } from "./InstrumentsSection";
import { RegisteredEngines } from "./RegisteredEngines";
import { Action, Row, Section } from "./Section";
import { SettingsTabs } from "./SettingsTabs";
import { StudiosSection } from "./StudiosSection";

/** U+001F joins the names `audio.priority` takes (engine/k7-supervisor/docs/hostProtocol.md). */
const SEP = "\u001f";

/** The interface the engine is on, said where the eye lands: beside its name, with the channels it actually opened. */
function DeviceBadge({
  text,
  inputs,
  outputs,
}: {
  text: string;
  inputs: number;
  outputs: number;
}) {
  const channels = [
    inputs > 0 && m["engine.channelsIn"]({ n: String(inputs) }),
    outputs > 0 && m["engine.channelsOut"]({ n: String(outputs) }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-[10px] text-emerald-500">
      {channels ? `${text} · ${channels}` : text}
    </span>
  );
}

function statusLine(
  s: DesktopEngineSnapshot | null,
  down: string | null,
): string {
  if (down) return down;
  if (!s) return m["engine.waiting"]();
  if (s.status === "running")
    return m["engine.running"]({ port: String(s.enginePort) });
  if (s.status === "error") return m["engine.error"]({ error: s.error ?? "" });
  return s.userStopped ? m["engine.stoppedByYou"]() : m["engine.stopped"]();
}

export function EnginePage() {
  const here = useOnDesktopEngine();
  const state = useDesktopEngine();
  const s = state?.snapshot ?? null;
  const running = s?.status === "running";
  const devices = s ? rankedDevices(s) : [];
  const names = devices.map((d) => d.name);
  const asio = s ? idleAsioDriver(s) : null;
  // Absent from an older supervisor, whose engine always asks pairing.
  const lanOpen = s?.lanOpen ?? false;
  const move = (from: number, to: number) =>
    engineCommand("audio.priority", moveDevice(names, from, to).join(SEP));
  // A server is added by pairing the account with it, which the machine's local user has none of.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void fetch("/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { user?: { local?: boolean } } | null) =>
        setSignedIn(!!b?.user && !b.user.local),
      )
      .catch(() => setSignedIn(false));
  }, []);

  const engineTab = (
    <>
      <Section title={m["engine.title"]()} hint={m["engine.hint"]()}>
        <Row
          label={statusLine(s, state?.down ?? null)}
          detail={s?.engineId ? m["engine.id"]({ id: s.engineId }) : undefined}
        >
          {running ? (
            <>
              <Action onClick={() => engineCommand("engine.restart")}>
                {m["engine.restart"]()}
              </Action>
              <Action danger onClick={() => engineCommand("engine.stop")}>
                {m["engine.stop"]()}
              </Action>
            </>
          ) : (
            <Action disabled={!s} onClick={() => engineCommand("engine.start")}>
              {m["engine.start"]()}
            </Action>
          )}
        </Row>
      </Section>

      <Section title={m["engine.audioTitle"]()} hint={m["engine.audioHint"]()}>
        {/* The engine on Windows' shared endpoint while the interface has its own driver: two channels a side, and the mixer's latency. */}
        {asio && (
          <Row
            label={
              <span className="text-amber-500">
                {m["engine.asioHint"]({ driver: asio })}
              </span>
            }
          >
            <Action onClick={() => move(names.indexOf(asio), 0)}>
              {m["engine.asioUse"]()}
            </Action>
          </Row>
        )}
        {devices.length === 0 ? (
          <Row label={m["engine.noDevices"]()} />
        ) : (
          devices.map((d, i) => (
            <Row
              key={d.name}
              label={
                <span className="flex items-center gap-2">
                  <span className="truncate">{d.name}</span>
                  {d.current && (
                    <DeviceBadge
                      text={m["engine.inUse"]()}
                      inputs={d.currentInput ? d.inputs : 0}
                      outputs={d.outputs}
                    />
                  )}
                  {d.currentInput && !d.current && (
                    <DeviceBadge
                      text={m["engine.inputs"]()}
                      inputs={d.inputs}
                      outputs={0}
                    />
                  )}
                </span>
              }
              detail={[d.deviceType, !d.present && m["engine.unplugged"]()]
                .filter(Boolean)
                .join(" · ")}
            >
              <Action
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                title={m["engine.up"]()}
              >
                <ArrowUp className="size-3.5" />
              </Action>
              <Action
                disabled={i === devices.length - 1}
                onClick={() => move(i, i + 1)}
                title={m["engine.down"]()}
              >
                <ArrowDown className="size-3.5" />
              </Action>
            </Row>
          ))
        )}
      </Section>

      <Section title={m["engine.lanTitle"]()} hint={m["engine.lanHint"]()}>
        <Row
          label={m["engine.lanOpen"]()}
          detail={lanOpen ? m["engine.lanOpenOn"]() : m["engine.lanOpenOff"]()}
        >
          <Switch
            checked={lanOpen}
            disabled={!s}
            onCheckedChange={(on) => engineCommand("lan.open", on ? "1" : "0")}
            aria-label={m["engine.lanOpen"]()}
          />
        </Row>
      </Section>
    </>
  );

  const serversTab = (
    <>
      <StudiosSection
        rows={(s?.instances ?? []).map((row) => ({
          ...row,
          // This backend's own row comes back at every start (backend/src/localEngine/settings.ts).
          removable:
            row.removable && new URL(row.url).origin !== location.origin,
        }))}
        check={s?.instanceCheck ?? undefined}
        // Paired through the browser: the account syncs there, and the engine is listed with its token (docs/settings.md).
        add={
          signedIn ? (url) => void accountBridge()?.addServer?.(url) : undefined
        }
        addHint={signedIn === false ? m["engine.serversSignIn"]() : null}
        // The engine leaves that server; the account keeps syncing with it.
        remove={(url) => engineCommand("weburi.remove", url)}
      />
      <AccountStatusNote />
    </>
  );

  const pluginsTab = (
    <Section
      title={m["engine.pluginsTitle"]()}
      hint={m["engine.pluginsHint"]()}
    >
      <Row
        label={
          s?.pluginCount === undefined
            ? m["engine.scanning"]()
            : m["engine.pluginCount"]({ n: String(s.pluginCount) })
        }
      >
        <Action
          disabled={!running}
          onClick={() => engineCommand("plugins.rescan")}
        >
          {m["engine.rescan"]()}
        </Action>
      </Row>
      {(s?.plugins ?? []).map((p) => (
        <Row
          key={`${p.format}:${p.name}`}
          label={p.name}
          detail={[p.manufacturer, p.format].filter(Boolean).join(" · ")}
        />
      ))}
    </Section>
  );

  return (
    <HomeShell>
      <PageFrame
        title={here ? m["engine.title"]() : m["engine.titleEngines"]()}
        narrow
      >
        {here === undefined ? null : !here ? (
          <div className="flex min-w-0 flex-col gap-4">
            <RegisteredEngines onTray={false} />
          </div>
        ) : (
          <SettingsTabs
            tabs={[
              {
                key: "engine",
                label: m["engine.tabEngine"](),
                content: engineTab,
              },
              {
                key: "servers",
                label: m["engine.tabServers"](),
                content: serversTab,
              },
              {
                key: "instruments",
                label: m["engine.tabInstruments"](),
                content: (
                  <InstrumentsSection snapshot={s} send={engineCommand} />
                ),
              },
              {
                key: "plugins",
                label: m["engine.tabPlugins"](),
                content: pluginsTab,
              },
              {
                key: "engines",
                label: m["engine.tabEngines"](),
                content: <RegisteredEngines onTray />,
              },
            ]}
          />
        )}
      </PageFrame>
    </HomeShell>
  );
}
