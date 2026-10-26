// SongbookServerCopy.tsx — on a machine paired with a server: where each song lives (here, both) and the
// server's songs this machine lacks, each with a download. The same icons as k7's workspaces and médiathèque.
// Nothing at all on an unpaired machine or on the server itself. See ../../../rehearsal-server/docs/songbookCopy.md.

import { Button } from "@frediverse/ui/button";
import {
  Cloud,
  CloudCheck,
  CloudDownload,
  HardDrive,
  Loader2,
} from "@frediverse/ui/icons";
import {
  downloadsSnapshot,
  isDownloading,
  queueDownload,
  subscribeDownloads,
} from "@studio/http-client/downloads";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { SongbookPlacement, SongListEntry } from "../types";

/** The server is asked again this often, for what another machine added there. */
const PLACEMENT_MS = 30_000;

export type SongPlacement = "synced" | "local";

/** The download manager's key for one song (../../../http-client/docs/downloads.md). */
const downloadKey = (id: string): string => `songbook:${id}`;

const songName = (s: { artist?: string; title: string }): string =>
  s.artist ? `${s.artist} — ${s.title}` : s.title;

const hostOf = (p: SongbookPlacement | null): string =>
  p?.server ? new URL(p.server).host : "";

/** The songbook's placement, re-asked whenever the local list reloads; null when there is nothing to say. */
export function useSongbookCopy(
  songs: SongListEntry[],
  onDownloaded: () => void,
  /** Asked only while the songbook is on screen. */
  active: boolean,
) {
  const [placement, setPlacement] = useState<SongbookPlacement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await api.songbookPlacement();
      setPlacement(p.paired ? p : null);
    } catch {
      // A server that is away says nothing about where songs are: no icons rather than wrong ones.
      setPlacement(null);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `songs` is the trigger, a local reload
  useEffect(() => {
    if (!active) return;
    void reload();
    const t = setInterval(() => void reload(), PLACEMENT_MS);
    return () => clearInterval(t);
  }, [songs, active, reload]);

  const download = useCallback(
    async (id: string, label: string) => {
      setError(null);
      try {
        await queueDownload(
          { key: downloadKey(id), kind: "songbook", label },
          () => api.downloadSong(id),
        );
        onDownloaded();
      } catch (e) {
        setError((e as Error).message);
      }
      await reload();
    },
    [onDownloaded, reload],
  );

  const synced = new Set(placement?.synced ?? []);
  return {
    placement,
    error,
    /** One local song's state, or null when the machine is not paired. */
    stateOf: (id: string): SongPlacement | null =>
      placement ? (synced.has(id) ? "synced" : "local") : null,
    download,
  };
}

/** One icon: synced with the server, or on this machine only. */
export function SongPlacementIcon({
  state,
  placement,
}: {
  state: SongPlacement | null;
  placement: SongbookPlacement | null;
}) {
  if (!state) return null;
  const said =
    state === "synced"
      ? m["songbook.sync.synced"]({ server: hostOf(placement) })
      : m["songbook.sync.local"]();
  const Icon = state === "synced" ? CloudCheck : HardDrive;
  return (
    <span
      title={said}
      role="img"
      aria-label={said}
      className={`songbook-placement${state === "synced" ? " synced" : ""}`}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** The server's songs this machine lacks, each with its download — never brought down on their own. */
export function ServerOnlySongs({
  copy,
}: {
  copy: ReturnType<typeof useSongbookCopy>;
}) {
  const all = useSyncExternalStore(subscribeDownloads, downloadsSnapshot);
  const { placement, error } = copy;
  if (!placement?.serverOnly.length && !error) return null;
  return (
    <div className="songbook-server-only">
      {error ? <p className="small error">{error}</p> : null}
      <ul>
        {placement?.serverOnly.map((s) => (
          <li key={s.id}>
            <span
              className="songbook-server-only-name muted"
              title={m["songbook.sync.server"]({ server: hostOf(placement) })}
            >
              <Cloud className="size-4 shrink-0" />
              <span className="truncate">{songName(s)}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={isDownloading(all, downloadKey(s.id))}
              onClick={() => void copy.download(s.id, songName(s))}
            >
              {isDownloading(all, downloadKey(s.id)) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CloudDownload className="size-4" />
              )}{" "}
              {m["songbook.sync.download"]()}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
