// useLogs.ts — the Logs panel's line buffer plus two tails: the engine machine's merged process
// log (`.studio.log`) and the file service's own lines (packages/file-service/docs/serviceLog.md),
// polled only while that panel is OPEN (nothing else reads it). The cost of not tailing
// while closed is that lines written in between are skipped rather than backfilled — the
// right trade for a live log you open to watch what happens NEXT.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LogLine } from "../components/LogsPanel";
import type { Panel } from "../routes";

/** The status line's setter: an `"error"` is also appended to the Logs panel, since the line is overwritten by the next message. */
export type SetStatus = (text: string, level?: "error") => void;

export function useLogs(panel: Panel | null): {
  logs: LogLine[];
  pushLog: (kind: LogLine["kind"], text: string) => void;
  clearLogs: () => void;
} {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const pushLog = useCallback((kind: LogLine["kind"], text: string) => {
    setLogs((l) => [...l, { t: Date.now(), kind, text }].slice(-500));
  }, []);
  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => {
    if (panel !== "logs") return;
    let alive = true;
    // Two cursors, one per half: the engine machine's `.studio.log` by byte, the file service's own lines by number.
    let offset: number | undefined;
    let after: number | undefined;
    const ingest = (lines: string[]) => {
      for (const raw of lines) {
        const mm = raw.match(/^\d\d:\d\d:\d\d \[([a-z]+)\] (.*)$/);
        const tag = mm?.[1];
        // `[engine]` and `[file]` keep their colours; the supervisor's own tags (host, registry, tunnel) read as info.
        const kind: LogLine["kind"] =
          tag === "engine" || tag === "file" ? tag : "info";
        pushLog(kind, mm ? `[${tag}] ${mm[2]}` : raw);
      }
    };
    const tick = async () => {
      try {
        const r = await api.logs(offset, 300, after);
        if (!alive) return;
        offset = r.offset;
        if (r.lines.length) ingest(r.lines);
        // Absent from a file service older than this page: the panel then shows the machine's half alone.
        if (r.service) {
          after = r.service.seq;
          for (const l of r.service.lines)
            pushLog(l.level === "info" ? "file" : "error", `[file] ${l.text}`);
        }
      } catch {
        /* file service unreachable or no log yet — retry next tick */
      }
    };
    void tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pushLog, panel]);

  return { logs, pushLog, clearLogs };
}
