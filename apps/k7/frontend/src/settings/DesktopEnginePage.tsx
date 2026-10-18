// DesktopEnginePage.tsx — `/settings/engine`, the desktop app's built-in engine: whether it runs, which
// audio interface it takes first, its plugins, and the instruments it downloads. What the command-line engine reads from its config file;
// the desktop app hands its user no such file, so its own menu leads here. See ../../docs/settings.md.

import { ArrowDown, ArrowUp } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { PageFrame } from "../projects/PageFrame";
import {
  type DesktopEngineSnapshot,
  engineCommand,
  idleAsioDriver,
  moveDevice,
  onDesktopEngine,
  rankedDevices,
  useDesktopEngine,
} from "./desktopEngine";
import { InstrumentsSection } from "./InstrumentsSection";
import { Action, Row, Section } from "./Section";

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

export function DesktopEnginePage() {
  const state = useDesktopEngine();
  const s = state?.snapshot ?? null;
  const running = s?.status === "running";
  const devices = s ? rankedDevices(s) : [];
  const names = devices.map((d) => d.name);
  const asio = s ? idleAsioDriver(s) : null;
  const move = (from: number, to: number) =>
    engineCommand("audio.priority", moveDevice(names, from, to).join(SEP));

  return (
    <HomeShell subtitle={m["engine.title"]()}>
      <PageFrame title={m["engine.title"]()} narrow>
        {!onDesktopEngine() ? (
          <p className="text-muted-foreground text-xs">
            {m["engine.notHere"]()}
          </p>
        ) : (
          <>
            <Section title={m["engine.title"]()} hint={m["engine.hint"]()}>
              <Row
                label={statusLine(s, state?.down ?? null)}
                detail={
                  s?.engineId ? m["engine.id"]({ id: s.engineId }) : undefined
                }
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
                  <Action
                    disabled={!s}
                    onClick={() => engineCommand("engine.start")}
                  >
                    {m["engine.start"]()}
                  </Action>
                )}
              </Row>
            </Section>

            <Section
              title={m["engine.audioTitle"]()}
              hint={m["engine.audioHint"]()}
            >
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
                    detail={[
                      d.deviceType,
                      !d.present && m["engine.unplugged"](),
                    ]
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

            <InstrumentsSection snapshot={s} send={engineCommand} />

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
                  detail={[p.manufacturer, p.format]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </Section>
          </>
        )}
      </PageFrame>
    </HomeShell>
  );
}
