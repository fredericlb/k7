// InstrumentsSection.tsx — the Downloads section: the sampled instruments an engine's machine keeps, each
// with its one action. Drawn by the desktop app's engine page and by the phone's engine section, which
// differ only in how a command reaches their supervisor. See ../../docs/settings.md.

import { m } from "../paraglide/messages.js";
import {
  type DesktopEngineSnapshot,
  type InstrumentRow,
  instrumentAction,
  instrumentRows,
  sizeOf,
} from "./desktopEngine";
import { Action, Row, Section } from "./Section";

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

export function InstrumentsSection({
  snapshot,
  send,
}: {
  snapshot: Pick<DesktopEngineSnapshot, "instruments" | "downloads"> | null;
  send: (cmd: string, name: string) => void;
}) {
  const instruments = snapshot ? instrumentRows(snapshot) : [];
  return (
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
                  onClick={() => send(action.cmd, i.name)}
                >
                  {m[`engine.instrument.${action.label}`]()}
                </Action>
              )}
            </Row>
          );
        })
      )}
    </Section>
  );
}
