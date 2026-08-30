// AudioSection.tsx — the interfaces, ranked. There is no default and no fallback: the list IS
// both, since a fallback was only ever the second line of it. The rows the user can see are the
// ranking plus anything else plugged in, and moving one sends the whole order back.
// See apps/studio-desktop/docs/settings.md.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import { PRIORITY_SEP as SEP } from "@studio/engine-host/hostProtocol";
import type { DesktopState } from "../desktop";
import {
  audioRows,
  forgottenPriority,
  movedPriority,
  rankedPriority,
} from "./rules";
import { Action, Row, Section } from "./Section";

export function AudioSection({
  state,
  send,
}: {
  state: DesktopState;
  send: (cmd: HostCommandName, arg?: string) => void;
}) {
  const s = state.snapshot;
  const rows = s ? audioRows(s) : [];
  const rank = (names: string[]) => send("audio.priority", names.join(SEP));

  return (
    <Section
      title="Audio interfaces"
      hint="Best first. The engine takes the highest one that is plugged in, and moves down when it is not there — so a rehearsal interface above the built-in output needs nothing said twice."
    >
      {rows.length === 0 ? (
        <Row
          label="No interface"
          detail={
            s?.status === "running"
              ? "the engine reports none"
              : "start the engine to see them"
          }
        />
      ) : (
        rows.map((r, i) => (
          <Row key={r.name} label={r.label} detail={r.detail}>
            {/* A device is either IN the list, with a place you can move, or not in it yet, with one button to put it there. */}
            {r.ranked ? (
              <>
                <Action
                  onClick={() => rank(movedPriority(rows, r.name, -1))}
                  disabled={i === 0}
                  title="Higher — the engine tries this one first"
                >
                  ↑
                </Action>
                <Action
                  onClick={() => rank(movedPriority(rows, r.name, 1))}
                  disabled={i === rows.length - 1}
                  title="Lower"
                >
                  ↓
                </Action>
              </>
            ) : (
              <Action
                onClick={() => rank(rankedPriority(rows))}
                title="Add it to the list, here — the engine only ever switches to a device you ranked"
              >
                Rank
              </Action>
            )}
            {/* Only where it is the one thing the arrows cannot do: a name for hardware that is gone. */}
            {!r.present && (
              <Action
                danger
                onClick={() => rank(forgottenPriority(rows, r.name))}
              >
                Forget
              </Action>
            )}
          </Row>
        ))
      )}
    </Section>
  );
}
