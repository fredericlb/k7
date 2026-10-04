// EngineLoadScreen.tsx — the gate's last wait: the opened project copied to the engine's machine,
// applied, and dry-run, each step said in words and the copy measured in files and megabytes. It
// ends when the file service stops reporting a load; a failed copy ends it too, and the app's own
// dialog takes over. See packages/file-service/docs/engineLoad.md.

import { HardDriveDownload } from "@frediverse/ui/icons";
import type { EngineLoadPhase, EngineSyncState } from "@studio/web-protocol";
import { useEffect, useRef, useState } from "react";
import { projectApi } from "./project.ts";

/** Fast: the screen is all there is, and a copy over a LAN takes seconds. */
const POLL_MS = 500;

export interface EngineLoadStrings {
  copyingTitle: string;
  copyingBody: string;
  applyingTitle: string;
  applyingBody: string;
  warmingTitle: string;
  warmingBody: string;
}

const DEFAULTS: EngineLoadStrings = {
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

/** Poll until the project is playable, then call `onReady` once. */
export function EngineLoadScreen({
  strings,
  onReady,
}: {
  strings?: EngineLoadStrings;
  onReady: () => void;
}) {
  const s = strings ?? DEFAULTS;
  const [phase, setPhase] = useState<EngineLoadPhase>("copying");
  const [sync, setSync] = useState<EngineSyncState | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const w = await projectApi.workspace();
        if (cancelled) return;
        if (!w.engineLoad) return ready.current();
        setPhase(w.engineLoad);
        setSync(w.engineSync ?? null);
      } catch {
        /* the service blinked; the next tick asks again */
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const copying = phase === "copying";
  const measured = copying && sync && sync.bytes > 0;
  const pct = measured
    ? Math.min(100, Math.round((sync.bytesDone / sync.bytes) * 100))
    : null;
  const title = copying
    ? s.copyingTitle
    : phase === "applying"
      ? s.applyingTitle
      : s.warmingTitle;
  const body = copying
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
