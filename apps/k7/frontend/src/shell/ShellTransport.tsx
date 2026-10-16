// ShellTransport.tsx — the transport centred over the header: play/pause, stop, the clock and
// record, each dropping focus on click so the keys stay the shell's (docs/shell.md). A set
// draws only the first two: it has no bars to count and no lane to arm.

import { Button } from "@frediverse/ui/button";
import { Circle, Loader2, Pause, Play, Square } from "@frediverse/ui/icons";
import type { EngineClient } from "@studio/engine-browser";
import type { TransportAction } from "@studio/engine-protocol";
import type { RefObject } from "react";
import type { SetStatus } from "../hooks/useLogs";
import type { RecInfo } from "../hooks/useProjectDoc";
import { blurOnClick } from "../keys";
import { m } from "../paraglide/messages.js";
import { TransportClock } from "../shellMeta";
import { NO_ARM_HINT } from "../ui/commands/transport";

export function ShellTransport({
  toolSize,
  playing,
  transportWaiting,
  recordWithoutArm,
  transport,
  noArrangement,
  recInfo,
  recordEnabled,
  midiArmed,
  openMidiInputs,
  setStatus,
  engineRef,
}: {
  toolSize: "icon" | "icon-xs";
  playing: boolean;
  /** The engine cannot answer the transport yet — loading, or the project still on its way. */
  transportWaiting: boolean;
  recordWithoutArm: boolean;
  transport: (a: TransportAction) => void;
  noArrangement: boolean;
  recInfo: RecInfo;
  recordEnabled: boolean;
  midiArmed: string | null;
  openMidiInputs: () => Promise<boolean>;
  setStatus: SetStatus;
  engineRef: RefObject<EngineClient | undefined>;
}) {
  return (
    <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex items-center gap-1">
      <Button
        size={toolSize}
        variant={playing ? "default" : "secondary"}
        // Dead while the engine loads a project, and in record mode with nothing armed — a rolling transport can always stop.
        disabled={transportWaiting || (!playing && recordWithoutArm)}
        onClick={(e) => {
          transport(playing ? "stop" : "play");
          blurOnClick(e);
        }}
        title={
          transportWaiting
            ? "Loading this project — the engine can't answer the transport yet"
            : !playing && recordWithoutArm
              ? NO_ARM_HINT
              : playing
                ? m["transport.pause"]()
                : m["transport.play"]()
        }
        aria-label={
          transportWaiting
            ? "loading the project"
            : playing
              ? m["transport.pause"]()
              : m["transport.play"]()
        }
        aria-busy={transportWaiting}
      >
        {transportWaiting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
      <Button
        size={toolSize}
        variant="secondary"
        onClick={(e) => {
          transport("stop");
          // Zero on a set too: every record is on a platter, and the timeline holds only the click.
          transport("rewind");
          blurOnClick(e);
        }}
        title={m["transport.stop"]()}
      >
        <Square className="h-4 w-4" />
      </Button>
      {/* The clock and record are the ARRANGEMENT's half: a set has no bars to count and no lane to arm. */}
      {!noArrangement && (
        <>
          <TransportClock
            tempo={recInfo.tempo}
            beatsPerBar={recInfo.beatsPerBar}
          />
          <Button
            size={toolSize}
            variant={recordEnabled ? "default" : "secondary"}
            aria-pressed={recordEnabled}
            onClick={(e) => {
              // A MIDI-armed lane is recorded by THIS record too: the press is the gesture Web MIDI's request rides.
              if (!recordEnabled && midiArmed)
                void openMidiInputs().then((ok) => {
                  if (!ok) setStatus(m["midi.unavailable"]());
                });
              engineRef.current?.setRecordEnabled(!recordEnabled);
              blurOnClick(e);
            }}
            title={m["transport.record"]()}
            aria-label={m["transport.record"]()}
          >
            <Circle
              className={`h-4 w-4 ${recordEnabled ? "fill-red-500 text-red-500" : ""}`}
            />
          </Button>
        </>
      )}
    </div>
  );
}
