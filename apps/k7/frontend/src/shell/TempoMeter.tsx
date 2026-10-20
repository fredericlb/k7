// TempoMeter.tsx — the project's tempo and meter, each number editing itself on a click.
// The footer draws it on a desktop and the Info popover on a phone, whose footer has no room (docs/shell.md).
import { askText } from "@studio/project-shell/ask";
import type { RecInfo } from "../hooks/useProjectDoc";
import { m } from "../paraglide/messages.js";

/** The doc's tempo and meter, not the engine's: what the metronome clicks, written through `project tempo` / `project meter`. */
export function TempoMeter({
  recInfo,
  runCommand,
}: {
  recInfo: RecInfo;
  runCommand: (line: string) => Promise<void>;
}) {
  return (
    <span className="flex items-center whitespace-nowrap font-mono tabular-nums">
      <button
        type="button"
        className="rounded px-0.5 hover:bg-accent hover:text-foreground"
        title={m["transport.tempoEdit"]()}
        onClick={() =>
          void askText({
            title: m["transport.tempoAsk"](),
            initial: String(recInfo.tempo),
            validate: (v) =>
              Number(v) >= 20 && Number(v) <= 400
                ? ""
                : m["transport.tempoBad"](),
          }).then((v) => {
            if (v) void runCommand(`project tempo ${v.trim()}`);
          })
        }
      >
        {recInfo.tempo} bpm
      </button>
      <span className="mx-1 text-border">·</span>
      <button
        type="button"
        className="rounded px-0.5 hover:bg-accent hover:text-foreground"
        title={m["transport.meterEdit"]()}
        onClick={() =>
          void askText({
            title: m["transport.meterAsk"](),
            initial: `${recInfo.beatsPerBar}/${recInfo.beatUnit}`,
            validate: (v) =>
              /^\d+\/(1|2|4|8|16|32)$/.test(v.trim())
                ? ""
                : m["transport.meterBad"](),
          }).then((v) => {
            if (v) void runCommand(`project meter ${v.trim()}`);
          })
        }
      >
        {recInfo.beatsPerBar}/{recInfo.beatUnit}
      </button>
    </span>
  );
}
