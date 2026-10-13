// DesktopEnginePage.tsx — `/settings/engine`, the desktop app's built-in engine: whether it runs, which
// audio interface it takes first, its plugins, and the instruments it downloads. What the command-line engine reads from its config file;
// the desktop app hands its user no such file, so its own menu leads here. See ../../docs/settings.md.

import { ArrowDown, ArrowUp } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import {
  type DesktopEngineSnapshot,
  engineCommand,
  type InstrumentRow,
  instrumentAction,
  instrumentRows,
  moveDevice,
  onDesktopEngine,
  rankedDevices,
  sizeOf,
  useDesktopEngine,
} from "./desktopEngine";
import { Action, Row, Section } from "./Section";

/** U+001F joins the names `audio.priority` takes (engine/st0-supervisor/docs/hostProtocol.md). */
const SEP = "\u001f";

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

/** What an instrument's row says under its name. */
function instrumentDetail(i: InstrumentRow): string {
  const of = sizeOf(i.bytes);
  if (i.phase === "queued") return m["engine.instrument.queued"]({ size: of });
  if (i.phase === "unpacking")
    return m["engine.instrument.unpacking"]({ size: of });
  if (i.phase === "failed")
    return m["engine.instrument.failed"]({ error: i.error ?? "" });
  if (i.installed) return m["engine.instrument.installed"]({ size: of });
  return i.wanted ? m["engine.instrument.missing"]({ size: of }) : of;
}

export function DesktopEnginePage() {
  const state = useDesktopEngine();
  const s = state?.snapshot ?? null;
  const running = s?.status === "running";
  const devices = s ? rankedDevices(s) : [];
  const instruments = s ? instrumentRows(s) : [];
  const names = devices.map((d) => d.name);
  const move = (from: number, to: number) =>
    engineCommand("audio.priority", moveDevice(names, from, to).join(SEP));

  return (
    <HomeShell subtitle={m["engine.title"]()}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
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
                      <Action
                        danger
                        onClick={() => engineCommand("engine.stop")}
                      >
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
                {devices.length === 0 ? (
                  <Row label={m["engine.noDevices"]()} />
                ) : (
                  devices.map((d, i) => (
                    <Row
                      key={d.name}
                      label={d.name}
                      detail={[
                        d.deviceType,
                        d.current && m["engine.inUse"](),
                        d.currentInput && !d.current && m["engine.inputs"](),
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

              <Section
                title={m["engine.downloadsTitle"]()}
                hint={m["engine.downloadsHint"]()}
              >
                {instruments.length === 0 ? (
                  <Row label={m["engine.noInstruments"]()} />
                ) : (
                  instruments.map((i) => {
                    const action = instrumentAction(i);
                    return (
                      <Row
                        key={i.name}
                        label={i.label}
                        detail={
                          i.phase === "downloading" ? (
                            <progress
                              className="h-1.5 w-full"
                              max={i.bytes || 1}
                              value={i.received}
                            />
                          ) : (
                            instrumentDetail(i)
                          )
                        }
                      >
                        {action && (
                          <Action
                            danger={action.label === "remove"}
                            onClick={() => engineCommand(action.cmd, i.name)}
                          >
                            {m[`engine.instrument.${action.label}`]()}
                          </Action>
                        )}
                      </Row>
                    );
                  })
                )}
              </Section>

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
        </div>
      </div>
    </HomeShell>
  );
}
