// EngineLoadScreen.tsx — the gate's last wait: the engine's plugin scan for a project naming an
// external plugin, then the project copied to the engine's machine, applied, and dry-run, each step
// said in words and the copy measured in files and megabytes. It
// ends when the file service stops reporting a load; a failed copy ends it too, and the app's own
// dialog takes over. See packages/file-service/docs/engineLoad.md.

import { HardDriveDownload } from "@frediverse/ui/icons";
import type {
  EngineLoadPhase,
  EngineScanState,
  EngineSyncState,
} from "@studio/web-protocol";
import { useEffect, useRef, useState } from "react";
import { fileRoutes } from "./files.ts";

/** Fast: the screen is all there is, and a copy over a LAN takes seconds. */
const POLL_MS = 500;

/** Failed asks in a row before the wait is given up and handed to the gate's error screen. */
const GIVE_UP_AFTER = 8;

export interface EngineLoadStrings {
  /** The wait for the engine's plugin scan, for a project naming an external plugin; English when absent. */
  scanningTitle?: string;
  scanningBody?: string;
  /** The scan's count, once it has listed the files. */
  scanningCount?: (done: number, total: number) => string;
  copyingTitle: string;
  copyingBody: string;
  applyingTitle: string;
  applyingBody: string;
  warmingTitle: string;
  warmingBody: string;
}

const DEFAULTS: EngineLoadStrings = {
  scanningTitle: "Waiting for the plugin scan",
  scanningBody:
    "This project uses plugins installed on the engine's machine, so it is sent to the engine once the engine has checked which ones are there.",
  scanningCount: (done, total) => `${done} / ${total}`,
  copyingTitle: "Copying the project to the engine",
  copyingBody:
    "Its audio files are copied to the machine the engine runs on before the project opens, so nothing is downloaded while it plays.",
  applyingTitle: "Loading the project on the engine",
  applyingBody: "The engine builds the song and loads its plugins.",
  warmingTitle: "Warming up",
  warmingBody:
    "The engine plays the first half-second with the sound off, so the first real play starts at once.",
};

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** Poll until the project is playable, then call `onReady` once — or `onFail`, when the service stops answering. */
export function EngineLoadScreen({
  strings,
  onReady,
  onFail,
}: {
  strings?: EngineLoadStrings;
  onReady: () => void;
  /** Asked too many times without an answer, or refused outright (401/403): the wait is over, said in words. */
  onFail?: (message: string) => void;
}) {
  const s = strings ?? DEFAULTS;
  const [phase, setPhase] = useState<EngineLoadPhase>("copying");
  const [sync, setSync] = useState<EngineSyncState | null>(null);
  const [scan, setScan] = useState<EngineScanState | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    const tick = async () => {
      try {
        const w = await fileRoutes.workspace();
        if (cancelled) return;
        if (!w.engineLoad) return ready.current();
        misses = 0;
        setPhase(w.engineLoad);
        setSync(w.engineSync ?? null);
        setScan(w.engineScan ?? null);
      } catch (e) {
        if (cancelled) return;
        // A refusal is an answer, and so is a service silent for a while: neither is worth a progress bar forever.
        const status = (e as { status?: number }).status;
        misses++;
        if (status === 401 || status === 403 || misses >= GIVE_UP_AFTER)
          return fail.current?.((e as Error).message);
      }
      // A blink backs off, doubling to five seconds, so a dead service is not asked twice a second.
      if (!cancelled)
        timer = setTimeout(tick, Math.min(5000, POLL_MS * 2 ** misses));
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const copying = phase === "copying";
  const scanning = phase === "scanning";
  const measured = copying && sync && sync.bytes > 0;
  const counted = scanning && scan && scan.total > 0;
  const pct = measured
    ? Math.min(100, Math.round((sync.bytesDone / sync.bytes) * 100))
    : counted
      ? Math.min(100, Math.round((scan.done / scan.total) * 100))
      : null;
  const title = scanning
    ? (s.scanningTitle ?? DEFAULTS.scanningTitle)
    : copying
      ? s.copyingTitle
      : phase === "applying"
        ? s.applyingTitle
        : s.warmingTitle;
  const body = scanning
    ? (s.scanningBody ?? DEFAULTS.scanningBody)
    : copying
      ? s.copyingBody
      : phase === "applying"
        ? s.applyingBody
        : s.warmingBody;

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <HardDriveDownload className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          className="h-1.5 w-full overflow-hidden rounded bg-muted"
        >
          <div
            className={
              pct === null
                ? "h-full w-1/3 animate-pulse bg-primary"
                : "h-full bg-primary transition-all"
            }
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        {counted && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {(s.scanningCount ?? DEFAULTS.scanningCount)?.(
              scan.done,
              scan.total,
            )}
          </p>
        )}
        {measured && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {sync.filesDone}/{sync.files} · {mb(sync.bytesDone)} /{" "}
            {mb(sync.bytes)}
          </p>
        )}
      </div>
    </div>
  );
}
