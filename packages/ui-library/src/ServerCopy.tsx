// ServerCopy.tsx — on a machine paired with a server: where each entry lives (here, there, both), and the download
// of an entry only the server holds — drawn in the tree among the rest. The same icons as k7's workspace list.
// Nothing at all on an unpaired machine or on the server itself. See ../../mediatek/docs/serverCopy.md.

import { Button } from "@frediverse/ui/button";
import {
  CloudCheck,
  CloudDownload,
  HardDrive,
  Loader2,
} from "@frediverse/ui/icons";
import {
  FAMILIES,
  type Family,
  type LibraryPlacement,
  type MediatekEntry,
} from "@studio/mediatek/types";
import { useCallback, useEffect, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import { missingUnder } from "./serverSets";

/** The server is asked again this often, for what another machine uploaded there. */
const PLACEMENT_MS = 30_000;

export type Placement = "synced" | "local";

/** The open family's placement, re-asked whenever the local listing reloads; null when there is nothing to say. */
export function useServerCopy(
  section: string,
  entries: MediatekEntry[] | null,
  onError: (message: string) => void,
) {
  const family = FAMILIES.includes(section as Family) ? section : null;
  const [placement, setPlacement] = useState<LibraryPlacement | null>(null);

  const reload = useCallback(async () => {
    if (!family) return setPlacement(null);
    try {
      const p = await library.placement(family);
      setPlacement(p.paired ? p : null);
    } catch {
      // A server that does not answer this once keeps what it said before: its songs must not vanish from the page.
    }
  }, [family]);

  // Another section is another family: what the last one's server said is not this one's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the family changing IS the signal.
  useEffect(() => setPlacement(null), [family]);

  // Keyed on `entries`: a local reload is when what is here changed.
  useEffect(() => {
    if (!entries) return;
    void reload();
    const t = setInterval(() => void reload(), PLACEMENT_MS);
    return () => clearInterval(t);
  }, [entries, reload]);

  const download = useCallback(
    async (paths: string[]) => {
      if (!family || !paths.length) return;
      try {
        await library.download(family, paths);
      } catch (e) {
        onError((e as Error).message);
      }
      // The local poll lists the new entry on its own; the placement is asked again at once.
      await reload();
    },
    [family, onError, reload],
  );

  const synced = new Set(placement?.synced ?? []);
  return {
    placement,
    /** One local entry's state, or null when the machine is not paired. */
    stateOf: (path: string): Placement | null =>
      placement ? (synced.has(path) ? "synced" : "local") : null,
    /** The server-only paths under a family-prefixed folder — what an album's download takes. */
    missingUnder: (folder: string): string[] =>
      placement ? missingUnder(placement.serverOnly, folder) : [],
    download,
  };
}

/** One icon: synced with the server, or on this machine only. */
export function PlacementIcon({
  state,
  server,
}: {
  state: Placement | null;
  server: string | null;
}) {
  const l = useLabels();
  if (!state) return null;
  const host = server ? new URL(server).host : "";
  const said =
    state === "synced" ? l.contents.synced(host) : l.contents.localOnly;
  const Icon = state === "synced" ? CloudCheck : HardDrive;
  return (
    <span
      title={said}
      role="img"
      aria-label={said}
      className="inline-flex shrink-0 self-center"
    >
      <Icon
        className={`size-3.5 ${state === "synced" ? "text-emerald-500" : "text-muted-foreground"}`}
      />
    </span>
  );
}

/** The download of one entry of the server's alone, at the end of its tree row — its spinner while it comes down. */
export function RemoteDownload({
  path,
  onDownload,
}: {
  /** Family-prefixed, as the server names it. */
  path: string;
  onDownload: (paths: string[]) => Promise<void>;
}) {
  const l = useLabels();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-muted-foreground"
      title={l.contents.download}
      aria-label={l.contents.download}
      aria-busy={busy}
      disabled={busy}
      onClick={(e) => {
        // The row behind it must not take the click as its own.
        e.stopPropagation();
        setBusy(true);
        void onDownload([path]).finally(() => setBusy(false));
      }}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CloudDownload className="size-3.5" />
      )}
    </Button>
  );
}
