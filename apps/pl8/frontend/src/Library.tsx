// Library.tsx — the catalogue: the sections as header tabs (the families and the raw capture
// zone), the current one's files as a tree down the side, its contents in the
// middle. Refetches a section only when ITS token moved, which is the whole reason the
// service hands out one per section. The chrome follows st0 — same shell, same tree.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  FileTree,
  type TreeAction,
  type TreeNode,
} from "@frediverse/ui/file-tree";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import type { RecordingDay } from "@studio/mediatek/recordings";
import { takesOf } from "@studio/mediatek/takes";
import {
  type MediatekEntry,
  RECORDINGS_DIR,
  SONG_FILE,
  type SongVariant,
} from "@studio/mediatek/types";
import { sortNodes } from "@studio/web-protocol/tree";
import {
  AudioLines,
  Disc3,
  FileQuestion,
  FolderTree,
  Loader2,
  LogOut,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecording } from "./AddRecording";
import { AddSong } from "./AddSong";
import { auth, library } from "./api";
import { folderAt } from "./assetTree";
import { FindSongs } from "./FindSongs";
import { OtherApps } from "./OtherApps";
import { MiniPlayer } from "./playback/MiniPlayer";
import { PlaybackPicker } from "./playback/PlaybackPicker";
import { PlaybackProvider } from "./playback/PlaybackProvider";
import { QueueAdvance } from "./playback/QueueAdvance";
import { usePlaybackTarget } from "./playback/usePlaybackTarget";
import { usePlayQueue } from "./playback/usePlayQueue";
import { DEFAULT_SECTION, folderOf, type SectionId } from "./routes";
import { sectionItems, sectionLabel } from "./SectionNav";
import { SongEditor } from "./SongEditor";
import { useLibraryRoute } from "./useLibraryRoute";

/** The five that ARE families, by subtraction — a section missing here becomes one silently (../docs/library.md). */
type FamilyId = Exclude<SectionId, typeof RECORDINGS_DIR | "find">;

/** Poll interval for the revision map — cheap on the server, slow enough to cost an idle library nothing. */
const POLL_MS = 3000;

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** Is this entry a SONG? The family alone answers — the scan stopped at the folder (../docs/library.md). */
const isSong = (e: MediatekEntry): boolean => e.family === "songs";

/** What `revealed` starts on: a NUL byte names no row, so only the top level unfolds (../docs/library.md). */
const TOP_LEVEL = "\u0000";

/** …and for a SONG, the one row of that family a menu may act on (../docs/library.md). */
const isSongFolder = (
  entries: MediatekEntry[] | null,
  path: string,
): boolean => {
  const e = path ? entryAt(entries, path) : null;
  return !!e && isSong(e);
};

/** The VARIANT a tree row stands for, and the song it belongs to — or null for every other row (../docs/library.md). */
const variantAt = (
  entries: MediatekEntry[] | null,
  path: string,
): { song: MediatekEntry; variant: SongVariant } | null => {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return null;
  const song = entryAt(entries, path.slice(0, cut));
  if (!song || !isSong(song)) return null;
  const variant = song.variants?.find((v) => v.name === path.slice(cut + 1));
  return variant ? { song, variant } : null;
};

/** The family's entries as a folder tree, from their paths alone (../docs/library.md). */
function treeOf(
  entries: MediatekEntry[] | null,
  unlisted: string[],
): TreeNode[] {
  const roots: TreeNode[] = [];
  // What no entry accounts for goes in FIRST, so an entry arriving later finds its folder already there.
  for (const rel of unlisted) {
    const cut = rel.lastIndexOf("/");
    const isFile = /\.[^./]+$/.test(rel);
    if (isFile) {
      const into = cut < 0 ? roots : folderAt(roots, rel.slice(0, cut));
      into.push({ name: rel.slice(cut + 1), path: rel });
    } else folderAt(roots, rel);
  }
  for (const e of entries ?? []) {
    // The family segment leads every path and is what the tabs already name.
    const parts = e.path.split("/").filter(Boolean).slice(1);
    let level = roots;
    let sofar = "";
    parts.forEach((part, i) => {
      sofar = sofar ? `${sofar}/${part}` : part;
      const leaf = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        // A SONG is the one leaf that stays a folder: it holds its variants and a drop on it makes one (../docs/library.md).
        const folds = leaf && e.family !== "songs";
        node = folds
          ? { name: part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
        // A song's children are the versions its SIDECAR declares, named by it and not by a file (../docs/library.md).
        if (leaf && isSong(e))
          node.children = (e.variants ?? []).map((v) => ({
            name: v.name,
            path: `${sofar}/${v.name}`,
          }));
      }
      if (!leaf) level = node.children ??= [];
    });
  }
  return roots;
}

/** The capture zone as tree rows: one folder per day, one row per capture (../docs/library.md). */
function dayNodes(days: RecordingDay[]): TreeNode[] {
  return days.map((d) => ({
    name: d.day,
    path: d.day,
    dir: true,
    children: d.files.map((f) => ({
      name: f.name,
      path: `${d.day}/${f.name}`,
    })),
  }));
}

/** A tree path (family-relative) back to its entry, keyed on the FULL path — two families can hold the same name. */
function entryAt(
  entries: MediatekEntry[] | null,
  path: string,
): MediatekEntry | null {
  return (entries ?? []).find((e) => relative(e.path) === path) ?? null;
}

/** Drop the leading family segment — the tab already names it, and so does the tree root. */
function relative(path: string): string {
  return path.split("/").filter(Boolean).slice(1).join("/");
}

function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function Library() {
  // The screen is mirrored in the URL both ways, and the URL is the one that holds it — see routes.ts.
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [file, setFile] = useState<string | null>(null);
  useLibraryRoute(
    { section, file },
    useCallback((next) => {
      setSection(next.section);
      setFile(next.file);
    }, []),
  );
  // The capture zone is a section with no family behind it: no `/list`, no entries, no module pane.
  const isZone = section === RECORDINGS_DIR;
  // « Trouver des morceaux » — a tabless section reached by a button, showing nothing on the volume (../docs/hunt.md).
  const isFind = section === "find";
  /** Is there a tree beside it? Derived here because the HEADER needs it: the drawer button is up there. */
  const hasTree = !isFind;
  // The tree's drawer on a narrow screen. Closed to begin with: arriving, you want the content.
  const [treeOpen, setTreeOpen] = useState(false);
  // Two sections refuse the tree's writes, and each has a header button instead (../docs/library.md).
  const editable = section !== "songs" && !isZone;
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  // What no entry accounts for — an empty folder, a loose file — which the service lists separately.
  const [unlisted, setUnlisted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // What a bulk action just DID: an outcome and not a fault, so never said in the destructive card next door.
  const [notice, setNotice] = useState<string | null>(null);
  // The capture zone's own listing, held apart from `entries` because nothing here is a catalogue entry.
  const [recordings, setRecordings] = useState<RecordingDay[]>([]);
  // Derived, never stored, and it synthesises the zone's own root row (../docs/library.md).
  const tree = useMemo<TreeNode[]>(
    () => [
      {
        name: section.toUpperCase(),
        path: "",
        dir: true,
        // Alphabetical all the way down: a listing arrives in scan order, which nobody can look something up in.
        children: sortNodes(
          isZone ? dayNodes(recordings) : treeOf(entries, unlisted),
        ),
      },
    ],
    [entries, isZone, recordings, section, unlisted],
  );
  // DERIVED from the route rather than held beside it, so a deep link needs no replay — see ../docs/routing.md.
  const editingSong = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && isSong(entry) ? entry : null;
  }, [entries, file]);
  /** What is open: what the tree marks active, opens down to, and what the middle of the screen shows. */
  const opened = editingSong;
  /** Where a drop lands, family-relative: the section, plus the folder the drop resolved to. */
  const assetsTarget = useCallback(
    (dir: string): string => (dir ? `${section}/${dir}` : section),
    [section],
  );
  /** Open the screen on a song's sidecar, or close it. The URL is the only writer. */
  const openFile = useCallback((rel: string | null) => {
    setFile(rel);
    // The drawer closes on what was just opened: it covers the screen it was asked to reveal.
    setTreeOpen(false);
  }, []);
  /** What the tree is opened down to. STICKY, and it starts on TOP_LEVEL — see ../docs/library.md. */
  const [revealed, setRevealed] = useState<string | null>(TOP_LEVEL);
  const target = opened ? relative(opened.path) : null;
  useEffect(() => {
    if (target) setRevealed(target);
  }, [target]);
  // Where sound comes out. Held here because the editors below need it too.
  const playback = usePlaybackTarget();
  // Held HERE because this component RENDERS the provider — see playback/usePlayQueue.ts.
  const playQueue = usePlayQueue();
  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});

  // The folder PICKER beside the drag: `webkitdirectory` is the input's property, not the click's (../docs/library.md).
  const pickRef = useRef<HTMLInputElement>(null);
  // The RESOLVED target, not the row that was clicked, so the picker and the drop land in the same place.
  const pickInto = useRef<string>("");
  const pickFolder = (dir: string) => {
    pickInto.current = assetsTarget(dir);
    if (pickRef.current) pickRef.current.value = ""; // else picking the same folder twice fires no `change`
    pickRef.current?.click();
  };

  // After a write of our own: forgetting the revision is what forces the next poll to reload (../docs/library.md).
  const refresh = useCallback(() => {
    seen.current[section] = "";
    setError(null);
  }, [section]);

  // A module's `ui.yaml` is DRAWN, never generated; the pass that built one from a plugin went (../docs/library.md).

  /** Reload SONGS whatever section is open, since the hunt page's finds land there. Stable — FindSongs polls on it. */
  const refreshSongs = useCallback(() => {
    seen.current.songs = "";
  }, []);

  // The variant PICKER beside the drop, so the menu says out loud which song it is adding to.
  const variantRef = useRef<HTMLInputElement>(null);
  const variantInto = useRef<string>("");
  const pickVariant = useCallback((song: string) => {
    variantInto.current = song;
    if (variantRef.current) variantRef.current.value = ""; // else the same file twice fires no `change`
    variantRef.current?.click();
  }, []);

  /** Audio filed as VERSIONS of a song — one request each, refusals collected (../docs/library.md). */
  const addVariants = useCallback(
    async (songPath: string, files: File[]) => {
      const refused: string[] = [];
      const added: string[] = [];
      for (const file of files) {
        if (!isAudio(file.name)) {
          refused.push(`${file.name} n'est pas un fichier audio`);
          continue;
        }
        try {
          added.push(
            (await library.addVariant(`songs/${songPath}`, file)).path,
          );
        } catch (e) {
          refused.push((e as Error).message);
        }
      }
      // Before the errors below: it clears the message, and what it clears must be the OLD one.
      refresh();
      if (refused.length) setError(refused.join(" · "));
      // The waveform, the onsets and the tempo, never awaited and best effort — this service
      // decodes them itself (packages/audio-analysis/docs/analysis.md).
      for (const path of added) void library.analyse(path).catch(() => {});
    },
    [refresh],
  );

  /** The right-click menu the SONGS family gets, and the only one it gets (../docs/library.md). */
  const songActions = useMemo<TreeAction<TreeNode>[]>(
    () =>
      section !== "songs"
        ? []
        : [
            {
              key: "add-variant",
              // The same gesture as the drop onto this row, said in words — a drag is not discoverable.
              label: "Ajouter une variante…",
              when: (t) => isSongFolder(entries, t.path),
              run: (t) => pickVariant(t.path),
            },
            {
              key: "queue-song",
              // The bottom bar's queue, not a playlist — see ../docs/miniPlayer.md.
              label: "Ajouter à la liste de lecture",
              // Only what actually has a master: an empty folder would make a row playback skips in silence.
              when: (t) => {
                const e = entryAt(entries, t.path);
                return !!e && takesOf(e).some((k) => k.kind === "master");
              },
              run: (t) => {
                const e = entryAt(entries, t.path);
                if (e) playQueue.enqueue([e]);
              },
            },
            {
              key: "delete-song",
              // Named as a folder: what goes is the master and its sidecar, not just the row. No confirmation.
              label: (t) => `Supprimer ${t.name}`,
              when: (t) => isSongFolder(entries, t.path),
              danger: true,
              // A song is a folder on disk though a leaf in the tree — the single-file route would leave the folder.
              run: (t) =>
                void library
                  .removeTree(`${section}/${t.path}`)
                  .then(() => {
                    // Close the editor when it shows what just went, or it empties itself on a dead address.
                    if (folderOf(file) === t.path) openFile(null);
                    refresh();
                  })
                  .catch((e: Error) => setError(e.message)),
            },
          ],
    [entries, file, openFile, pickVariant, playQueue.enqueue, refresh, section],
  );

  useEffect(() => {
    void library
      .summary()
      .then((s) => {
        setPresent(s.present);
        setCounts(s.counts);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async (f: FamilyId, rev: string) => {
    try {
      const l = await library.list(f);
      seen.current[f] = rev;
      setEntries(l.entries);
      setUnlisted(l.unlisted ?? []);
      setCounts((c) => ({ ...c, [f]: l.entries.length }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** The zone's own reload — its own route, and its own token in the same map. */
  const loadZone = useCallback(async (rev: string) => {
    try {
      const { days } = await library.recordings();
      seen.current[RECORDINGS_DIR] = rev;
      setRecordings(days);
      setCounts((c) => ({
        ...c,
        [RECORDINGS_DIR]: days.reduce((n, d) => n + d.files.length, 0),
      }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** Changing section drops what was held AND the token claiming it was current (../docs/library.md). */
  useEffect(() => {
    setEntries(null);
    setUnlisted([]);
    setNotice(null);
    setTreeOpen(false);
    seen.current[section] = "";
  }, [section]);

  // One poll drives every section OF THE LIBRARY, the capture zone included (../docs/library.md).
  useEffect(() => {
    if (isFind) return; // not on the volume — nothing of its own to poll here
    let stop = false;
    const tick = async () => {
      try {
        const { present: p, revisions } = await library.revisions();
        if (stop) return;
        setPresent(p);
        const rev = revisions[section];
        if (rev !== undefined && seen.current[section] !== rev)
          await (isZone ? loadZone(rev) : load(section as FamilyId, rev));
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [isFind, isZone, load, loadZone, section]);

  return (
    /* Wrapping the whole shell: what plays belongs to the TAB (../docs/miniPlayer.md). */
    <PlaybackProvider playQueue={playQueue}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* The families sit in the header, where st0 puts its views; the bar is @frediverse/ui's. */}
        <AppHeader
          // No `variant`: the house look, the accent tinted over the page.
          title="pl8"
          subtitle={sectionLabel(section)}
          items={sectionItems(section, counts, setSection)}
          className="z-20"
          actions={
            <>
              {/* The tree's drawer button, on a narrow screen only — see ../docs/responsive.md. */}
              {hasTree ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  aria-label="Arborescence"
                  onClick={() => setTreeOpen(true)}
                >
                  <FolderTree className="h-5 w-5" />
                </Button>
              ) : null}
              {/* Every section the tree cannot write has its button here — see ../docs/library.md. */}
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                {section === "songs" ? (
                  <>
                    {/* Beside « Ajouter » and not in its place: it LEADS to a page — see ../docs/hunt.md. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSection("find")}
                    >
                      {/* The icon alone when the room runs out: the sentence is what costs the hundred pixels. */}
                      <Search className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">
                        Trouver des morceaux
                      </span>
                    </Button>
                    <AddSong onDone={refresh} />
                  </>
                ) : null}
                {isZone ? (
                  <AddRecording onDone={refresh} onError={setError} />
                ) : null}
                {/* The version goes first: it is the only thing here nobody ever needs in the moment. */}
                <span className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
                  {VERSION}
                </span>
              </div>
              {/* The way out to the studio's other apps — first of the three because it is the only one that LEAVES. */}
              <OtherApps />
              {/* Where sound comes out, beside the cog: it is changed while listening — see ../docs/playbackTarget.md. */}
              <PlaybackPicker
                target={playback.target}
                onChoose={playback.choose}
              />
              {/* One cog for what belongs to the person: signing out. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Réglages">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem onSelect={() => void auth.logout()}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Se déconnecter
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        {/* The hunt page draws its own scroller, because its history can be long. */}
        {isFind ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <FindSongs
              onBack={() => setSection("songs")}
              onFiled={refreshSongs}
            />
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* An engine gate stood here over the Modules section; the section itself is gone (../docs/library.md). */}
            {/* The drawer's veil, which exists only while it is open: an invisible cover swallows clicks. */}
            {treeOpen && (
              <button
                type="button"
                aria-label="Fermer l'arborescence"
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setTreeOpen(false)}
              />
            )}
            {/* A column when there is room and a DRAWER when there is not, same markup — see ../docs/responsive.md. */}
            <aside
              className={`shrink-0 overflow-auto border-r p-2 md:static md:z-auto md:block md:w-60 md:translate-x-0 ${
                treeOpen
                  ? "fixed inset-y-0 left-0 z-40 w-72 bg-background shadow-xl"
                  : "hidden"
              }`}
            >
              <input
                ref={pickRef}
                type="file"
                multiple
                // @ts-expect-error — the directory picker is prefixed and absent from React's typings.
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []).map(
                    (file) => ({
                      path: file.webkitRelativePath || file.name,
                      file,
                    }),
                  );
                  // Already section-prefixed and mapped through `assetsTarget` — `pickFolder` is the only writer.
                  const target = pickInto.current;
                  e.target.value = "";
                  if (files.length)
                    void library
                      .uploadTree(target, files)
                      .then(refresh)
                      .catch((err: Error) => setError(err.message));
                }}
              />
              {/* …and the one the variant menu opens: that one names a directory, a variant is one audio file. */}
              <input
                ref={variantRef}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  const song = variantInto.current;
                  e.target.value = "";
                  if (files.length) void addVariants(song, files);
                }}
              />
              <FileTree
                nodes={tree}
                // The family IS the root: every node path below is relative to it.
                rootPath=""
                rootLabel={section.toUpperCase()}
                // The entry being edited outranks the merely selected one — same value `revealed` follows.
                activePath={target}
                // Open down to it, so a reloaded deep link lands on a tree showing where it is. Sticky.
                reveal={revealed}
                // A SONG is a folder row you OPEN: its chevron unfolds its versions, its name opens its sidecar.
                opensOnName={(n) => isSongFolder(entries, n.path)}
                onOpen={(n) => {
                  // A VARIANT row opens its SONG: the sidecar is where it is renamed, re-pointed or removed.
                  const v = variantAt(entries, n.path);
                  if (v)
                    return openFile(`${relative(v.song.path)}/${SONG_FILE}`);
                  const entry = entryAt(entries, n.path);
                  if (!entry) return;
                  // A song names its sidecar, which is the left half of what opens.
                  if (isSong(entry)) openFile(`${n.path}/${SONG_FILE}`);
                }}
                // A song wears the glyph of its own tab, and a variant the two SongVariants draws.
                icon={(n) => {
                  const v = variantAt(entries, n.path);
                  if (v)
                    return v.variant.kind === "file" ? (
                      <AudioLines className="h-4 w-4 shrink-0" />
                    ) : (
                      <FileQuestion className="h-4 w-4 shrink-0" />
                    );
                  const e = entryAt(entries, n.path);
                  if (e && isSong(e))
                    return <Disc3 className="h-4 w-4 shrink-0" />;
                  return null;
                }}
                // Undefined rather than a no-op where nothing may be dropped, and a tree drop for songs (../docs/library.md).
                onDropTree={
                  editable
                    ? (dir, files) =>
                        void library
                          .uploadTree(assetsTarget(dir), files)
                          .then(refresh)
                          .catch((e: Error) => setError(e.message))
                    : section === "songs"
                      ? (dir, files) =>
                          void (isSongFolder(entries, dir)
                            ? addVariants(
                                dir,
                                files.map((f) => f.file),
                              )
                            : setError(
                                "Un fichier n'entre dans les morceaux que comme variante de l'un d'eux : déposez-le sur le morceau.",
                              ))
                      : undefined
                }
                // Present, so rows are draggable — folders included, since `moveEntry` renames a directory too.
                onMove={
                  editable
                    ? (from, toDir) =>
                        void library
                          .move(
                            `${section}/${from}`,
                            // Through the same mapping a drop goes through, or the two would disagree.
                            `${assetsTarget(toDir)}/${from.split("/").pop()}`,
                          )
                          .then(refresh)
                          .catch((e: Error) => setError(e.message))
                    : undefined
                }
                cancelLabel="Annuler"
                // Every target needs one action whose `when` passes, or no menu opens at all (../docs/library.md).
                actions={
                  !editable
                    ? songActions
                    : [
                        {
                          key: "upload-folder",
                          label: "Téléverser un dossier…",
                          // Through `assetsTarget`, exactly like the drop: the two must land in the same place.
                          when: (t) => t.dir || t.root,
                          run: (t) => pickFolder(t.path),
                        },
                        {
                          key: "new-folder",
                          label: "Nouveau dossier…",
                          // Somewhere to drop into before the first file, and never beside a module's definition.
                          when: (t) => t.dir || t.root,
                          prompt: { placeholder: "nom", submit: "Créer" },
                          run: (t, value) =>
                            void library
                              .newFolder(`${assetsTarget(t.path)}/${value}`)
                              .then(refresh)
                              .catch((e: Error) => setError(e.message)),
                        },
                        {
                          key: "new-file",
                          label: "Nouveau fichier…",
                          when: (t) => t.dir || t.root,
                          prompt: { placeholder: "nom.yaml", submit: "Créer" },
                          run: (t, value) =>
                            void library
                              .writeFile(
                                `${section}/${t.path ? `${t.path}/` : ""}${value}`,
                                "",
                              )
                              .then(refresh)
                              .catch((e: Error) => setError(e.message)),
                        },
                        {
                          key: "rename",
                          label: "Renommer…",
                          when: (t) => !t.root,
                          prompt: {
                            placeholder: "nouveau nom",
                            initial: (t) => t.name,
                            submit: "Renommer",
                          },
                          run: (t, value) =>
                            void library
                              .move(
                                `${section}/${t.path}`,
                                `${section}/${[...t.path.split("/").slice(0, -1), value].join("/")}`,
                              )
                              .then(refresh)
                              .catch((e: Error) => setError(e.message)),
                        },
                        {
                          key: "delete",
                          label: (t) => `Supprimer ${t.name}`,
                          when: (t) => !t.root,
                          danger: true,
                          // `t.dir` alone would delete a song with the single-file route and leave its folder.
                          run: (t) =>
                            void (
                              t.dir || isSongFolder(entries, t.path)
                                ? library.removeTree(`${section}/${t.path}`)
                                : library.remove(`${section}/${t.path}`)
                            )
                              .then(refresh)
                              .catch((e: Error) => setError(e.message)),
                        },
                      ]
                }
              />
            </aside>

            {/* A module view and a chain editor stood at the head of this chain of screens (../docs/library.md). */}
            {editingSong ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SongEditor
                  entry={editingSong}
                  vimMode={localStorage.getItem("pl8.vim") === "1"}
                  playbackTarget={playback.target}
                  onBack={() => openFile(null)}
                  onSaved={refresh}
                />
              </main>
            ) : (
              <main className="min-w-0 flex-1 overflow-auto p-3 sm:p-6">
                {notice ? (
                  <Card className="mb-4 p-4 text-sm text-muted-foreground">
                    {notice}
                  </Card>
                ) : null}
                {error ? (
                  <Card className="p-4 text-sm text-destructive">{error}</Card>
                ) : present === false ? (
                  // A real answer, not a failure: the volume is mounted but nothing is in it yet.
                  <Card className="p-6 text-sm text-muted-foreground">
                    La médiathèque est vide pour l'instant.
                  </Card>
                ) : isZone ? (
                  // The zone's own view: the captures by day, and no entry columns (packages/mediatek/docs/recordings.md).
                  recordings.length === 0 ? (
                    <Card className="p-6 text-sm text-muted-foreground">
                      Aucun enregistrement pour l'instant. Les machines poussent
                      ici par l'API ; le bouton envoie un lot à la main.
                    </Card>
                  ) : (
                    <div className="flex flex-col gap-6">
                      {recordings.map((d) => (
                        <section key={d.day}>
                          <h2 className="mb-1 text-sm font-semibold tabular-nums">
                            {d.day}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {d.files.length}
                            </span>
                          </h2>
                          <ul className="flex flex-col">
                            {d.files.map((f) => (
                              <li
                                key={f.path}
                                className="flex items-baseline gap-3 rounded-md px-3 py-1.5 hover:bg-accent/40"
                              >
                                <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                                  {f.name}
                                </span>
                                <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                  {bytes(f.bytes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )
                ) : entries === null ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : entries.length === 0 ? (
                  <Card className="p-6 text-sm text-muted-foreground">
                    Rien dans cette famille pour l'instant.
                  </Card>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {entries.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-baseline gap-3 rounded-md px-3 py-2 hover:bg-accent/40"
                        // A song OPENS, the way its tree row does: the two copies must not mean different things.
                        onClick={() =>
                          isSong(e)
                            ? openFile(`${relative(e.path)}/${SONG_FILE}`)
                            : undefined
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {e.name}
                        </span>
                        {/* Not filed: found on disk with no sidecar, and worth SAYING rather than hiding. */}
                        {e.meta?.catalogued === false ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            non catalogué
                          </span>
                        ) : null}
                        {e.meta?.artist ? (
                          <span className="text-xs text-muted-foreground">
                            {String(e.meta.artist)}
                          </span>
                        ) : null}
                        {e.meta?.pack ? (
                          <span className="text-xs text-muted-foreground">
                            {String(e.meta.pack)}
                          </span>
                        ) : null}
                        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                          {e.kind}
                        </span>
                        <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {bytes(e.bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </main>
            )}

            {/* A third column for a picked MODULE stood here; it went with the family. */}

            {/* A song's variants were a fourth column until clicking a song began to OPEN it (../docs/library.md). */}
          </div>
        )}

        {/* What is playing belongs to the TAB rather than to any screen — see ../docs/miniPlayer.md. */}
        {/* Draws nothing: it is the queue's advance, and it needs the destination. */}
        <QueueAdvance target={playback.target} />
        <MiniPlayer />
      </div>
    </PlaybackProvider>
  );
}
