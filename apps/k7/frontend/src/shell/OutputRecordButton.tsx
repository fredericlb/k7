// OutputRecordButton.tsx — the bar's one button on a project with no timeline: record what the project sends out,
// and its clock while it does. The recording itself is useOutputRecording's. See packages/song/docs/outputRecording.md.

import { Button } from "@frediverse/ui/button";
import { Circle, Loader2 } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

/** `m:ss` of `ms`. */
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function OutputRecordButton({
  recording,
  filing,
  onToggle,
  size,
}: {
  recording: boolean;
  /** The take is being filed: the button waits, so a press does not start another over it. */
  filing: boolean;
  onToggle: () => void;
  size: "icon" | "icon-xs";
}) {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!recording) return setSince(null);
    const t0 = performance.now();
    setSince(t0);
    setNow(t0);
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [recording]);
  const label = recording ? m["record.stop"]() : m["record.start"]();
  return (
    <span className="flex items-center gap-2">
      <Button
        size={size}
        variant={recording ? "default" : "secondary"}
        aria-pressed={recording}
        disabled={filing}
        onClick={onToggle}
        title={label}
        aria-label={label}
      >
        {filing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Circle
            className={`h-4 w-4 ${recording ? "fill-red-500 text-red-500" : ""}`}
          />
        )}
      </Button>
      {since !== null && (
        <span className="font-mono text-xs tabular-nums">
          {clock(now - since)}
        </span>
      )}
    </span>
  );
}
