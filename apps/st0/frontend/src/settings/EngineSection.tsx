// EngineSection.tsx — the engine, its plugins and its audio interface. The rules the tray menu
// carried come with it: Stop and Restart are enabled ONLY for an engine this supervisor spawned
// (a foreign one belongs to whoever started it), and a dead file service turns the status red
// even with the engine fine, because "running" would otherwise be a lie.
// See apps/studio-desktop/docs/settings.md.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import type { DesktopState } from "../desktop";
import {
  audioRow,
  engineActions,
  fileServiceWarning,
  missingDevice,
  pluginsLine,
  statusLine,
} from "./rules";
import { Action, Row, Section } from "./Section";

export function EngineSection({
  state,
  send,
}: {
  state: DesktopState;
  send: (cmd: HostCommandName, arg?: string) => void;
}) {
  const s = state.snapshot;
  const { canStart, canStop, reason } = engineActions(state);

  return (
    <Section title="Engine" hint={fileServiceWarning(s)}>
      <Row
        label={statusLine(state)}
        detail={s ? `registry ${s.registryUrl}` : undefined}
      >
        <Action onClick={() => send("engine.start")} disabled={!canStart}>
          Start
        </Action>
        <Action
          onClick={() => send("engine.stop")}
          disabled={!canStop}
          title={reason}
        >
          Stop
        </Action>
        {/* One command, not stop-then-start: the supervisor sequences it, so no crash watch
            tick sees the gap and "recovers" mid-restart. */}
        <Action
          onClick={() => send("engine.restart")}
          disabled={!canStop}
          title={reason}
        >
          Restart
        </Action>
      </Row>

      <Row
        label={pluginsLine(state)}
        detail="A rescan clears the count, so the scan is visible while it runs."
      >
        <Action
          onClick={() => send("plugins.rescan")}
          disabled={s?.status !== "running"}
        >
          Rescan
        </Action>
      </Row>

      <Row label="File service" detail={s ? `:${s.filePort}` : undefined}>
        <Action
          onClick={() => send("fileService.restart")}
          disabled={!canStop}
          title={reason}
        >
          Restart
        </Action>
        <Action
          onClick={() => send("waveforms.clear")}
          disabled={!canStop}
          title={reason}
        >
          Clear waveform cache
        </Action>
      </Row>

      {(s?.audioDevices.length || s?.audioPreferred) && (
        <AudioRows state={state} send={send} />
      )}
    </Section>
  );
}

function AudioRows({
  state,
  send,
}: {
  state: DesktopState;
  send: (cmd: HostCommandName, arg?: string) => void;
}) {
  const s = state.snapshot;
  if (!s) return null;
  const missing = missingDevice(s);

  return (
    <>
      {s.audioDevices.map((d) => (
        <Row key={d.name} {...audioRow(d, s)}>
          <Action
            onClick={() => send("audio.select", d.name)}
            disabled={d.current}
          >
            Use
          </Action>
          <Action
            onClick={() => send("audio.fallback", d.name)}
            disabled={s.audioFallback === d.name}
          >
            Fallback
          </Action>
        </Row>
      ))}
      {missing && (
        // Listed even when absent, or "why am I not on my interface?" has no answer on screen.
        <Row label={`○ ${missing}`} detail="preferred — not connected" />
      )}
      <Row
        label={`Fallback: ${s.audioFallback ?? "none"}`}
        detail="Where to go when the pick is not there — the point is never to end up on no device."
      >
        {/* "" is meaningful on the wire: it IS none. */}
        <Action
          onClick={() => send("audio.fallback", "")}
          disabled={s.audioFallback === null}
        >
          None
        </Action>
      </Row>
    </>
  );
}
