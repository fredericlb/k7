// SongSyncDownloads.tsx — the backend's update check of the songs that follow the server, and each song it brings
// down again, mirrored into the download manager as the supervisor's instruments are. Polled on a machine's own
// backend only (a phone, the tray); nothing on a server. See ../../../backend/docs/media/songUpdates.md.

import { syncDownloads } from "@studio/http-client/downloads";
import type { SongSyncJob } from "@studio/mediatek/types";
import { useEffect, useRef } from "react";
import { BASE } from "../api";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { inAndroidApp } from "../tabs/bridge";
import { SONG_SYNC_PREFIX, songSyncRows } from "./songSyncRows";

/** Inside the backend's six-second linger, so every finished check is seen once; a GET to this machine costs nothing. */
const BUSY_MS = 2_000;
const IDLE_MS = 5_000;

const words = () => ({
  checking: m["downloads.checking"](),
  upToDate: m["downloads.upToDate"](),
  updated: (count: number) =>
    count === 1
      ? m["downloads.updatedOne"]()
      : m["downloads.updatedMany"]({ count }),
  gone: (count: number) =>
    count === 1 ? m["downloads.goneOne"]() : m["downloads.goneMany"]({ count }),
});

export function SongSyncDownloads() {
  const local = useLocalApp();
  const machine = inAndroidApp() || !!local;
  const handed = useRef(new Set<string>());
  useEffect(() => {
    if (!machine) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let jobs: SongSyncJob[] = [];
      try {
        const r = await fetch(`${BASE}/api/sync/library/jobs`, {
          cache: "no-store",
        });
        if (r.ok) jobs = ((await r.json()) as { jobs: SongSyncJob[] }).jobs;
      } catch {
        // This machine's backend restarting: the next poll asks again.
      }
      if (!live) return;
      syncDownloads(
        SONG_SYNC_PREFIX,
        songSyncRows(jobs, words(), handed.current),
      );
      const busy = jobs.some((j) => j.phase === "running");
      timer = setTimeout(() => void poll(), busy ? BUSY_MS : IDLE_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [machine]);
  return null;
}
