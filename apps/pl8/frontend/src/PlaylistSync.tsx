// PlaylistSync.tsx — the Sync button on a set list: the machine's targets in a dropdown, and a
// bar while the copy runs. The button belongs to the PLAYLIST, so it sits in that header rather
// than in the row toolbar, which acts on lines. See ../docs/sync.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import type { SyncJob } from "@studio/web-protocol";
import { FolderSync, HardDrive, Loader2, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SyncTargetRow, sync } from "./api";
import { readPrefs } from "./prefs";

/** Fast enough that a file landing shows, slow enough for a copy that lasts minutes. */
const POLL_MS = 1500;

export function PlaylistSync({ playlist }: { playlist: string }) {
  const [engineId, setEngineId] = useState<string | null>(null);
  const [targets, setTargets] = useState<SyncTargetRow[] | null>(null);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  // The run outlives a render, so the poll is stopped by a ref rather than by state.
  const stop = useRef(false);

  useEffect(() => {
    void readPrefs().then((p) => setEngineId(p.engineId ?? null));
  }, []);

  /** Re-read on every open: a stick is plugged in and a target added while this screen is up. */
  const load = useCallback(async () => {
    if (!engineId) return;
    try {
      setTargets((await sync.targets(engineId)).targets);
      setError("");
    } catch (e) {
      setTargets([]);
      setError((e as Error).message);
    }
  }, [engineId]);

  useEffect(() => {
    return () => {
      stop.current = true;
    };
  }, []);

  const run = async (target: string) => {
    if (!engineId) return;
    stop.current = false;
    setError("");
    setJob(null);
    setSkipped([]);
    try {
      const started = await sync.start(playlist, engineId, target);
      setSkipped(started.skipped);
      let current = started.job;
      setJob(current);
      while (!current.done && !stop.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        current = await sync.status(current.id, engineId);
        setJob(current);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = !!job && !job.done;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <DropdownMenu onOpenChange={(open) => open && void load()}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" disabled={busy || !engineId}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin sm:mr-1" />
              ) : (
                <FolderSync className="h-4 w-4 sm:mr-1" />
              )}
              <span className="hidden sm:inline">Synchroniser</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {targets === null ? (
              <DropdownMenuItem disabled>chargement…</DropdownMenuItem>
            ) : targets.length ? (
              targets.map((t) => (
                <DropdownMenuItem key={t.name} onClick={() => void run(t.name)}>
                  {t.scheme === "ftp" ? (
                    <Server className="mr-2 h-4 w-4" />
                  ) : (
                    <HardDrive className="mr-2 h-4 w-4" />
                  )}
                  <span className="truncate">{t.name}</span>
                  <span className="ml-2 truncate text-muted-foreground text-xs">
                    {t.uri}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              // Not an error: most machines have no target, and the remedy is on the machine.
              <DropdownMenuItem disabled>
                cette machine n'a aucune cible
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* No engine chosen is a different sentence from a machine with no targets. */}
        {!engineId ? (
          <span className="text-muted-foreground text-xs">
            choisissez un moteur pour synchroniser
          </span>
        ) : null}
      </div>

      {job ? (
        <div className="min-w-0">
          <div className="h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className={`h-full transition-all ${job.failed ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${job.percent}%` }}
            />
          </div>
          <div className="truncate text-muted-foreground text-xs">
            {job.failed
              ? job.error
              : job.done
                ? `${job.target} — ${job.copied} copié${job.copied > 1 ? "s" : ""}, ${job.skipped} déjà là${job.m3u ? `, ${job.m3u}` : ""}`
                : `${job.phase} — ${job.copied + job.skipped}/${job.total}`}
          </div>
          {/* What did NOT go, named: a line the volume has no song for, or a track that failed. */}
          {job.done && (job.lines.length || skipped.length) ? (
            <ul className="mt-0.5 space-y-0.5 text-destructive text-xs">
              {skipped.map((s) => (
                <li key={s} className="truncate">
                  {s} : morceau introuvable
                </li>
              ))}
              {job.lines.map((l) => (
                <li key={l} className="truncate">
                  {l}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="text-destructive text-xs">{error}</div> : null}
    </div>
  );
}
