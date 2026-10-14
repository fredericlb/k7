// ServerCopy.tsx — on a machine paired with a server: where each entry lives (here, there, both) and the
// server-only entries with a button to bring one, or a folder's worth, down. The same icons as k7's workspace list.
// Nothing at all on an unpaired machine or on the server itself. See ../../mediatek/docs/serverCopy.md.

import { Button } from "@frediverse/ui/button";
import {
  Cloud,
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
import { byFolder, missingUnder } from "./serverSets";

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

/** The server's entries this machine lacks, by folder, each and each folder with its download — never brought down on their own. */
export function ServerOnlyEntries({
  placement,
  onDownload,
}: {
  placement: LibraryPlacement | null;
  onDownload: (paths: string[]) => Promise<void>;
}) {
  const l = useLabels();
  // A path, or a folder for its whole group: one download at a time either way.
  const [downloading, setDownloading] = useState<string | null>(null);
  if (!placement?.serverOnly.length) return null;
  const host = placement.server ? new URL(placement.server).host : "";
  const start = (key: string, paths: string[]) => {
    setDownloading(key);
    void onDownload(paths).finally(() => setDownloading(null));
  };
  const icon = (key: string) =>
    downloading === key ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : (
      <CloudDownload className="size-3.5" />
    );
  return (
    <div className="mt-2 flex flex-col gap-2">
      {byFolder(placement.serverOnly).map((g) => (
        <section key={g.folder}>
          {/* A lone entry needs no "all"; a family's root has no folder to name. */}
          {g.entries.length > 1 && g.folder.includes("/") ? (
            <header className="flex items-center gap-3 px-3 py-1 text-muted-foreground text-xs">
              <span className="min-w-0 flex-1 truncate">
                {g.folder.split("/").slice(1).join(" / ")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={downloading !== null}
                onClick={() =>
                  start(
                    g.folder,
                    g.entries.map((e) => e.path),
                  )
                }
              >
                {icon(g.folder)} {l.contents.downloadAll(g.entries.length)}
              </Button>
            </header>
          ) : null}
          <ul className="flex flex-col gap-1">
            {g.entries.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-1.5"
              >
                <span
                  title={l.contents.serverOnly(host)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-muted-foreground"
                >
                  <Cloud className="size-3.5 shrink-0" />
                  <span className="truncate">{e.name}</span>
                  {e.meta?.artist ? (
                    <span className="text-xs">{String(e.meta.artist)}</span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={downloading !== null}
                  onClick={() => start(e.path, [e.path])}
                >
                  {icon(e.path)} {l.contents.download}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
