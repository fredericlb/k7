// useLogs.ts — the Logs panel's line buffer plus the tail of the merged process log,
// polled only while that panel is OPEN (nothing else reads it). The cost of not tailing
// while closed is that lines written in between are skipped rather than backfilled — the
// right trade for a live log you open to watch what happens NEXT.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LogLine } from "../components/LogsPanel";
import type { Panel } from "../routes";

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
    let offset: number | undefined;
    const ingest = (lines: string[]) => {
      for (const raw of lines) {
        const mm = raw.match(/^\d\d:\d\d:\d\d \[(engine|file)\] (.*)$/);
        const kind: LogLine["kind"] = mm
          ? (mm[1] as "engine" | "file")
          : "info";
        pushLog(kind, mm ? `[${mm[1]}] ${mm[2]}` : raw);
      }
    };
    const tick = async () => {
      try {
        const r = await api.logs(offset);
        if (!alive) return;
        offset = r.offset;
        if (r.lines.length) ingest(r.lines);
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
