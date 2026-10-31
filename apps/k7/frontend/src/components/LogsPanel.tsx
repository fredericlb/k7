// LogsPanel.tsx — the "Logs" bottom panel: a scrolling transcript of engine +
// brain activity (command output, status changes, engine connection events). The
// app shell keeps the buffer; this just renders and auto-scrolls to the newest line.

import { useEffect, useRef } from "react";
import { m } from "../paraglide/messages.js";
import { PanelCloseButton } from "./PanelClose";

export interface LogLine {
  t: number; // epoch ms
  // cmd/info/refused/error/engine are in-app activity; `engine` and `file` also carry the engine machine's merged process log.
  kind: "cmd" | "engine" | "file" | "info" | "refused" | "error";
  text: string;
}

const KIND_CLASS: Record<LogLine["kind"], string> = {
  cmd: "text-sky-400",
  engine: "text-violet-400",
  file: "text-teal-400",
  info: "text-muted-foreground",
  // A refusal is not an error but a verb declining, so it is amber and deliberately distinct from `info`.
  refused: "text-amber-400",
  error: "text-red-400",
};

export function LogsPanel({
  lines,
  onClear,
}: {
  lines: LogLine[];
  onClear: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <PanelCloseButton />
        <span className="font-semibold text-primary-text">Logs</span>
        <span className="text-muted-foreground">{lines.length} lines</span>
        <button
          onClick={onClear}
          className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <div className="text-muted-foreground">{m["logs.empty"]()}</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-faint">
                {new Date(l.t).toLocaleTimeString()}
              </span>
              <span
                className={`whitespace-pre-wrap break-all ${KIND_CLASS[l.kind]}`}
              >
                {l.text}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
