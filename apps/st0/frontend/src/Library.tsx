// Library.tsx — the catalogue: the sections as header tabs (the families, the repositories and
// the raw capture zone), the current one's files as a tree down the side, its contents in the
// middle. Refetches a section only when ITS token moved, which is the whole reason the
// service hands out one per section. The chrome follows l8 — same shell, same tree.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  FileTree,
  type TreeAction,
  type TreeNode,
} from "@frediverse/ui/file-tree";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import { PLAYLIST_EXT, playlistStub } from "@studio/mediatek/playlist";
import type { RecordingDay } from "@studio/mediatek/recordings";
import {
  CHAINS_FILE,
  type MediatekEntry,
  RECORDINGS_DIR,
  SONG_FILE,
  type SongVariant,
} from "@studio/mediatek/types";
import { engineFaceModule, FACE_CATEGORIES } from "@studio/song/engineFace";
import type { BuilderPane } from "@studio/ui-module-builder";
import type { RepoSummary } from "@studio/web-protocol";
import {
  Activity,
  AudioLines,
  Boxes,
  Disc3,
  FolderGit2,
  ListMusic,
  Loader2,
  LogOut,
  type LucideIcon,
  Mic,
  Pencil,
  Search,
  Settings,
  Waves,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecording } from "./AddRecording";
import { AddSong } from "./AddSong";
import { auth, engineMachine, library, projects } from "./api";
import { ChainEditor } from "./ChainEditor";
import { EngineStatusBar } from "./EngineStatusBar";
import { EnginePage } from "./engine/EnginePage";
import { EngineList, EnginePicker } from "./engine/EnginePicker";
import { ModuleParams } from "./engine/ModuleParams";
import { useEngineChoice } from "./engine/useEngineChoice";
import { FindSongs } from "./FindSongs";
import { ModuleEditor } from "./ModuleEditor";
import { OtherApps } from "./OtherApps";
import { PlaylistEditor } from "./PlaylistEditor";
import { MiniPlayer } from "./playback/MiniPlayer";
import { PlaybackPicker } from "./playback/PlaybackPicker";
import { PlaybackProvider } from "./playback/PlaybackProvider";
import { QueueAdvance } from "./playback/QueueAdvance";
import { usePlaybackTarget } from "./playback/usePlaybackTarget";
import { usePlayQueue } from "./playback/usePlayQueue";
import { projectCount } from "./projects/count";
import { ProjectsSection } from "./projects/ProjectsSection";
import {
  DEFAULT_SECTION,
  fileOf,
  folderOf,
  PROJECTS_SECTION,
  type SectionId,
} from "./routes";
import { SongEditor } from "./SongEditor";
import { takesOf } from "./songTakes";
import { sortNodes } from "./treeOrder";
import { useLibraryRoute } from "./useLibraryRoute";

/**
 * The header's tabs: the repositories, then the five families and the raw capture zone.
 *
 * PROJECTS leads because it is what the app OPENS on (`DEFAULT_SECTION` in routes.ts), and a
 * tab strip whose first tab is not the landing screen reads as a mistake. It is also the
 * section furthest from the volume: it is not on it at all — a repository belongs to a
 * person, this service never makes a working copy of one, and its listing comes from
 * `/api/projects` rather than from the catalogue. See ../../docs/projects.md.
 *
 * RECORDINGS is a section and NOT a family either — it is a folder at the library root, it
 * holds no catalogue entries, and it has no listing to ask `/list` for. It sits here because
 * the screen is organised by what you are looking at, and what you are looking at is a fifth
 * thing. See packages/mediatek/docs/recordings.md.
 */
const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: PROJECTS_SECTION, label: "Projets", icon: FolderGit2 },
  { id: "songs", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "chains", label: "Chaînes", icon: Workflow },
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: RECORDINGS_DIR, label: "Enregistrements", icon: Mic },
];

/** The five that ARE families — the only ids `/list` and `/manifest` accept. Subtracted rather
 *  than listed, so a new family is one entry in `SECTION_IDS`; the cost is that every section
 *  which is NOT one has to be named here, or it silently becomes a family the poll would ask
 *  the server for. */
type FamilyId = Exclude<
  SectionId,
  typeof RECORDINGS_DIR | typeof PROJECTS_SECTION | "engine" | "find"
>;

/** Poll interval for the revision map. Cheap on the server (a walk per family, only when
 *  something moved) and slow enough that a library nobody is touching costs nothing. */
const POLL_MS = 3000;

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** The three files a module is: what it does, how it looks, and its named settings (see `@studio/song`'s
 *  docs/uiLibrary.md and docs/userPresets.md). The TREE no longer draws them — a module is one row, and
 *  the builder edits all three — but the ADDRESS still names one, so a deep link opens the right pane. */
const MODULE_FILE = "module.yaml";
const UI_FILE = "ui.yaml";
const PRESETS_FILE = "presets.yaml";

/** Which pane the file in the address opens the builder on. */
const PANE_OF: Record<string, BuilderPane> = {
  [MODULE_FILE]: "module",
  [UI_FILE]: "panel",
  [PRESETS_FILE]: "presets",
};

/**
 * Does this entry HOLD a `module.yaml`? That file is what makes a folder a module.
 *
 * Being listed under `modules/` is not enough, and the scanner says so out loud: a folder with
 * no module file is listed anyway, flagged `catalogued: false`, because "it is what a folder you
 * just made looks like, and one you cannot see is one you cannot drop into" (see scan.ts). Those
 * are CATEGORIES — `audio/filter` holding `auto-wah` — and a category has to stay a folder you
 * can open and fill. Reading the entry's family alone folded every one of them into a module.
 */
const holdsModuleFile = (e: MediatekEntry): boolean =>
  e.family === "modules" && !!e.files?.includes(MODULE_FILE);

/** The file that IS a chain, the same way `module.yaml` is a module. Imported rather than
 *  restated: it moved into types.ts (which opens no `node:fs`) so the browser could have it. */
const holdsChainsFile = (e: MediatekEntry): boolean =>
  e.family === "chains" && !!e.files?.includes(CHAINS_FILE);

/** Is this entry a SONG? The family alone answers, unlike the two above: a song folder is
 *  what the scan stopped at, so every entry in the family is one — sidecar or not. A folder
 *  with no `song.yaml` is `catalogued: false`, which is a song nobody filed, not a category. */
const isSong = (e: MediatekEntry): boolean => e.family === "songs";

/** Is this entry a PLAYLIST? The family answers, as it does for a song — but the entry is the
 *  FILE here rather than the folder around it, which is why nothing below pairs it with a
 *  canonical name the way `SONG_FILE` and `CHAINS_FILE` are paired. See
 *  packages/mediatek/docs/playlists.md. */
const isPlaylist = (e: MediatekEntry): boolean => e.family === "playlists";

/**
 * What `revealed` starts on, so a section opens SHOWING its first level instead of collapsed
 * onto the one root row it synthesises below.
 *
 * `reveal` opens a target's ancestors, and the synthesised root's empty path is the ancestor of
 * every path there is (see commons's file-tree.tsx) — so any target at all unfolds the top
 * level. This one names no row, because NUL is the one byte no path can hold, so the top level
 * is all it unfolds: what is below stays folded until something is actually revealed.
 */
const TOP_LEVEL = "\u0000";

/** Where a module keeps what it LOADS — samples, IRs, amp profiles — as opposed to what it IS.
 *  The same folder `@studio/song` resolves a module's own assets out of, so a file dropped here
 *  is one the engine will find. Named once; the scan uses its own copy (scan.ts's ASSETS_DIR). */
const ASSETS_DIR = "assets";

/**
 * Is this tree path a MODULE?
 *
 * The one entry that is a FOLDER on disk and a LEAF in the tree, so neither `t.dir` nor the
 * path's shape can answer — only the listing can.
 */
const isModuleFolder = (
  entries: MediatekEntry[] | null,
  path: string,
): boolean => {
  const e = path ? entryAt(entries, path) : null;
  return !!e && holdsModuleFile(e);
};

/** The same question for a CHAIN, which is the row that is a folder on disk and a leaf in the
 *  tree — so `t.dir` says no about it, and a delete has to know better. */
const holdsChain = (entries: MediatekEntry[] | null, path: string): boolean => {
  const e = path ? entryAt(entries, path) : null;
  return !!e && holdsChainsFile(e);
};

/** …and for a SONG, which is a folder on disk and a leaf in the tree like a chain, and the
 *  ONLY row of that family a menu may act on: everything above it is an artist or an album,
 *  a segment the scan deduced from tags rather than a thing anyone made. */
const isSongFolder = (
  entries: MediatekEntry[] | null,
  path: string,
): boolean => {
  const e = path ? entryAt(entries, path) : null;
  return !!e && isSong(e);
};

/**
 * The VARIANT a tree row stands for, and the song it belongs to — or null for every other row.
 *
 * A variant row's path is its song's plus the name the sidecar files it under (see treeOf), so
 * this cuts at the last slash and asks the listing whether what is left is a song. Nothing else
 * in the tree has that shape: a song is a leaf-shaped folder, so it has no other children.
 */
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

/** Walk a family-relative folder path into the tree, creating what is missing. Returns the
 *  level INSIDE it, so a caller can keep descending. */
function folderAt(roots: TreeNode[], rel: string): TreeNode[] {
  let level = roots;
  let sofar = "";
  for (const part of rel.split("/").filter(Boolean)) {
    sofar = sofar ? `${sofar}/${part}` : part;
    let node = level.find((n) => n.name === part);
    if (!node) {
      node = { name: part, path: sofar, dir: true, children: [] };
      level.push(node);
    }
    level = node.children ??= [];
  }
  return level;
}

/**
 * The family's entries as a folder tree, from their paths alone — the service hands out a flat
 * list, and the shape is already in the strings. Directories are synthesised on the way down, so
 * a folder holding only folders still appears.
 *
 * Except what no entry can stand for — an empty folder, a loose file: those arrive as their own
 * list and are walked in first (see scanUnlisted). Without them, creating a folder answered 200
 * and showed nothing, which is the one thing a "create" must never do.
 *
 * A MODULE's children are its ASSETS and nothing else — what it loads, not what it is. Its
 * definition (module.yaml, the panel, the shelf, its instances) stays behind one row that opens the
 * builder: rows were once drawn per file, and each one opened the same screen a different way,
 * while a row for a file that is not there lied about the disk. What a module carries is the
 * opposite case — bytes nothing can create for you, that have to be visible to be dropped on.
 */
function treeOf(
  entries: MediatekEntry[] | null,
  unlisted: string[],
): TreeNode[] {
  const roots: TreeNode[] = [];
  // What no entry accounts for goes in FIRST — an empty folder, a loose file. `folderAt` walks
  // a path into place either way, so an entry arriving later finds its folder already there.
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
        // A CHAIN is a LEAF, folder though it is on disk: its file is its definition, not
        // contents to browse. A MODULE is the one row that is both — you open it, and it holds
        // the assets it loads — so it stays a folder and `opensOnName` gives the tree the two
        // targets that needs (see the FileTree below).
        //
        // Everything else keeps the shape it had. In `modules/` that matters: an entry with no
        // module file is a CATEGORY — or a folder you just made — and folding it would leave
        // you unable to open it, let alone put a module in it.
        // A SONG is the third of that kind, and folds for neither reason: it holds its
        // variants, and a file dropped on it becomes one — which needs a row that is a drop
        // target, and the shared tree only makes folders into those.
        const folds =
          leaf &&
          (!["modules", "chains", "songs"].includes(e.family) ||
            holdsChainsFile(e));
        node = folds
          ? { name: part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
        // A module's children: what its `assets/` folder holds. Named at their real path, so a
        // drop, a rename and a delete all address the file that is actually there.
        if (leaf && holdsModuleFile(e))
          node.children = (e.assets ?? []).map((name) => ({
            name,
            path: `${sofar}/${ASSETS_DIR}/${name}`,
          }));
        // A song's children: the versions its sidecar declares. Named by that sidecar and NOT
        // by a file, because half of them are not files — a chain variant names a template in
        // another family — so the name is the one thing every variant has and the only one
        // that is unique within a song. The path is therefore an identity, the way the
        // synthesised root's is, and nothing addresses it as a file. See variantAt.
        else if (leaf && isSong(e))
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

/**
 * The capture zone as tree rows: one folder per day, one row per capture.
 *
 * Its own function and not `treeOf`, which reads `MediatekEntry.path` — there are no
 * entries here to read. Paths are zone-relative, mirroring how a family's rows drop their
 * family segment, so the root row the tree synthesises names the zone exactly once.
 */
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

/** A tree path (family-relative) back to the entry it came from. Keyed on the FULL path,
 *  not a suffix: two families can hold the same name, and so can two folders. */
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
  // The screen is mirrored in the URL both ways, and the URL is the one that holds it: the
  // section, and the file the builder has open. See routes.ts.
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [file, setFile] = useState<string | null>(null);
  useLibraryRoute(
    { section, file },
    useCallback((next) => {
      setSection(next.section);
      setFile(next.file);
    }, []),
  );
  // The capture zone is a section without a family behind it: no `/list`, no entries, no
  // module pane. Everything below reads this rather than testing the string twice.
  const isZone = section === RECORDINGS_DIR;
  // The repositories go further: not on the volume at all, so no tree down the side either —
  // the section draws its own screen edge to edge.
  const isProjects = section === PROJECTS_SECTION;
  // The cog's engine-status page — a section with no tab, no tree and no library poll:
  // everything it shows comes from the engine's own socket. See engine/EnginePage.tsx.
  const isEngine = section === "engine";
  // « Trouver des morceaux » — même forme que la page moteur : une section sans onglet, atteinte
  // par un bouton depuis Morceaux, qui dessine bord à bord. Rien de ce qu'elle montre n'est sur
  // le volume non plus : l'historique vient de `/api/hunt`. Voir ../../docs/hunt.md.
  const isFind = section === "find";
  // Whether the TREE may write. Two sections say no, for two different reasons: `songs/`
  // has a shape deduced from tags — a folder made by hand there is not a badly filed
  // song, it is an invisible one — and a capture is named by the clock, so a renamed one
  // would be a capture at an hour it was not made. Both have a header button instead; see
  // packages/mediatek/docs/songs.md and docs/recordings.md.
  const editable = section !== "songs" && !isZone && !isProjects;
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  // What no entry accounts for — an empty folder, a loose file. It cannot be inferred from
  // the entry paths, which is the whole point, so the service lists it and the tree draws it.
  const [unlisted, setUnlisted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The capture zone's own listing. Held APART from `entries` because it is apart: nothing
  // here is a catalogue entry, and it arrives from its own route.
  const [recordings, setRecordings] = useState<RecordingDay[]>([]);
  // …and the repositories, apart for the same reason and one more: they are not on the volume.
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  // The module whose parameters are on screen. Modules only — a sample has none to ask for.
  const [picked, setPicked] = useState<MediatekEntry | null>(null);
  // Derived, not stored: the tree IS the entry list in another shape, so a second copy
  // could only ever disagree with it.
  //
  // The zone's own row is SYNTHESISED here, as a real node. `rootLabel` looks like it
  // would do this and does not — the shared component uses it only to name the target of
  // the background context menu, never to draw a row (see file-tree.tsx). Wrapping the
  // nodes is the only way to get a visible root, and it also gives the zone somewhere to
  // drop onto when the family is still empty.
  const tree = useMemo<TreeNode[]>(
    () => [
      {
        name: section.toUpperCase(),
        path: "",
        dir: true,
        // Alphabetical, all the way down and whichever builder made the rows: a listing arrives
        // in the order the scan walked it, which is an order nobody can look something up in.
        children: sortNodes(
          isZone ? dayNodes(recordings) : treeOf(entries, unlisted),
        ),
      },
    ],
    [entries, isZone, recordings, section, unlisted],
  );
  // …and the one being EDITED, which takes over the middle of the screen — the tree stays,
  // so the next module is one click away instead of a trip back through the catalogue. Only
  // the médiathèque is editable, so this is the one place in the repo a module can be written
  // from.
  //
  // DERIVED from the route, not held beside it. The address names a file; the entry it belongs
  // to comes from a listing that arrives later, so a deep link would otherwise have to be
  // replayed once the entries land. Here it simply resolves the moment they do, and `null`
  // covers both "nothing open" and "not loaded yet" — the catalogue shows through until then.
  const editing = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    if (!entry || !holdsModuleFile(entry)) return null;
    return { entry, pane: PANE_OF[fileOf(file) ?? ""] ?? "module" };
  }, [entries, file]);
  // The same derivation for a CHAIN. Its own memo rather than a branch inside the one above:
  // the two editors take different props, and a union that carried both would be read apart
  // again at every use.
  const editingChain = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && holdsChainsFile(entry) ? entry : null;
  }, [entries, file]);
  // …and for a SONG, whose address names its sidecar the same way. Third memo, same reason.
  const editingSong = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && isSong(entry) ? entry : null;
  }, [entries, file]);
  // …and for a PLAYLIST, which is the one that does NOT go through `folderOf`: its file IS the
  // entry, so the address's second half is already the path to look up. Same shape of memo, one
  // level less of path. See packages/mediatek/docs/playlists.md.
  const editingPlaylist = useMemo(() => {
    const entry = file ? entryAt(entries, file) : null;
    return entry && isPlaylist(entry) ? entry : null;
  }, [entries, file]);
  /** Whichever of the four is open. What the tree marks active and opens down to, and what
   *  the middle of the screen is showing — three questions with one answer. */
  const opened =
    editing?.entry ?? editingChain ?? editingSong ?? editingPlaylist;
  /**
   * Where a drop lands, family-relative — `assets/` when the row it fell on is a MODULE.
   *
   * The tree hands over the folder that was hit, and for a module that folder holds its
   * definition; what is being dropped is material it loads. Every other row keeps the path it
   * gave, including a row INSIDE a module's assets, whose own folder is already the right one.
   */
  const assetsTarget = useCallback(
    (dir: string): string => {
      const at = isModuleFolder(entries, dir) ? `${dir}/${ASSETS_DIR}` : dir;
      return at ? `${section}/${at}` : section;
    },
    [entries, section],
  );
  /** Open the builder on one of a module's files, or close it. The URL is the only writer. */
  const openFile = useCallback((rel: string | null) => setFile(rel), []);
  /**
   * What the tree is opened down to. STICKY, and that is the point: `reveal` re-seeds the whole
   * expansion whenever its value CHANGES, so letting it fall back to null on closing the editor
   * would collapse the tree the person had just been browsing. It only ever moves to a new
   * target.
   *
   * It also has to survive the listing arriving late. A deep link names a file before `entries`
   * has come back, so `editing` is null on the first render and resolves a poll later — the
   * effect is what carries the reveal across that gap.
   *
   * It starts on TOP_LEVEL rather than on nothing, which is what unfolds a freshly opened
   * section down to its first level and no further.
   */
  const [revealed, setRevealed] = useState<string | null>(TOP_LEVEL);
  const target = opened
    ? relative(opened.path)
    : picked
      ? relative(picked.path)
      : null;
  useEffect(() => {
    if (target) setRevealed(target);
  }, [target]);
  // No socket of its own — it only lists and remembers. PlaybackProvider holds the tab's one
  // connection, and two hooks opening one would be two clients on one session.
  const choice = useEngineChoice();
  // Where sound comes out. Held here, beside the engine pick, because both belong to the
  // account and both are drawn in this header — and because the editors below need it: a
  // destination that could only be read where it is drawn would not reach the player.
  const playback = usePlaybackTarget();
  // Tenue ICI parce que ce composant REND le provider — il est donc au-dessus du contexte, et
  // c'est lui qui porte l'arbre dont le clic droit remplit la file. Voir playback/usePlayQueue.ts.
  const playQueue = usePlayQueue();
  // What the chosen MACHINE has scanned, flattened across formats — the vocabulary for
  // "give this plugin a face". It comes from that machine's file service, not from this
  // app's backend, which is hosted and has no scan cache of its own. Empty is "cannot
  // say" — an unreachable engine, or an origin it hasn't been told to trust — never
  // "no plugins", which is why nothing is refused on the strength of an empty list.
  const [plugins, setPlugins] = useState<string[]>([]);
  useEffect(() => {
    if (section !== "modules" || !choice.fileBase || !choice.token)
      return setPlugins([]);
    let alive = true;
    void engineMachine
      .plugins(choice.fileBase, choice.token)
      .then((byFormat) => {
        if (alive)
          setPlugins([...new Set(Object.values(byFormat).flat())].sort());
      })
      .catch(() => alive && setPlugins([]));
    return () => {
      alive = false;
    };
  }, [section, choice.fileBase, choice.token]);
  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});

  // The folder PICKER, beside the drag. A module is a folder, so "add a module" has to be able to name one —
  // and a drag-and-drop that fails does so silently, which is a bad only-way-in. `webkitdirectory` is the
  // input's property, not the click's, hence a dedicated hidden input; `webkitRelativePath` is what it fills.
  const pickRef = useRef<HTMLInputElement>(null);
  const pickInto = useRef<string>("");
  const pickFolder = (dir: string) => {
    pickInto.current = dir;
    if (pickRef.current) pickRef.current.value = ""; // else picking the same folder twice fires no `change`
    pickRef.current?.click();
  };

  // After a write of our own. Forgetting the revision is what forces the next poll to
  // reload: waiting for the server's token to move would leave the tree stale for a beat,
  // and the person who just dropped a file is looking straight at it.
  const refresh = useCallback(() => {
    seen.current[section] = "";
    setError(null);
  }, [section]);

  /**
   * Recharger MORCEAUX, quelle que soit la section ouverte.
   *
   * `refresh` invalide le jeton de la section courante, ce qui est juste partout sauf sur la
   * page de recherche : elle est la section `find`, et ce qu'elle vient de ranger est dans
   * `songs`. Stable (`[]`), parce que FindSongs en dépend pour son intervalle — une fonction
   * recréée à chaque rendu reconstruirait le poll indéfiniment.
   */
  const refreshSongs = useCallback(() => {
    seen.current.songs = "";
  }, []);

  // The variant PICKER, beside the drop — the same pairing the folder picker has above, and
  // for the same reason: a drag that lands on the wrong row fails silently, so the menu says
  // out loud which song it is adding to.
  const variantRef = useRef<HTMLInputElement>(null);
  const variantInto = useRef<string>("");
  const pickVariant = useCallback((song: string) => {
    variantInto.current = song;
    if (variantRef.current) variantRef.current.value = ""; // else the same file twice fires no `change`
    variantRef.current?.click();
  }, []);

  /**
   * Audio files filed as VERSIONS of a song — dropped on its row, or picked from its menu.
   *
   * One request each, because each one writes a line in the sidecar and the second must read
   * the first's: sending them at once would have two writers deciding independently that
   * `instrumental` was free. The refusals are collected rather than thrown, so a folder
   * holding one PDF still files its four takes.
   */
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
      // The waveform, the onsets and the tempo, on the machine that has an engine — a file
      // variant is a file in the library and nothing about it is special (docs/variants.md).
      // Never awaited, and best effort: the version is filed either way.
      if (choice.fileBase && choice.token)
        for (const path of added)
          void engineMachine
            .analyse(choice.fileBase, choice.token, path)
            .catch(() => {});
    },
    [choice.fileBase, choice.token, refresh],
  );

  /**
   * The right-click menu the SONGS family gets: add a version, or remove the morceau.
   *
   * `editable` is false there and stays false — creating, renaming and moving in `songs/` are
   * what the tags decide, and a folder made by hand at the wrong level is an invisible song
   * (see packages/mediatek/docs/songs.md). Neither of these touches that shape: one writes
   * INSIDE a song that already exists, the other takes a whole one away.
   *
   * `when` accepts a row only when the listing calls it a song, so the artist and the album
   * above it are offered neither — a variant of an album is not a thing, and one click there
   * would delete every morceau underneath. The tree opens no menu at all when nothing passes,
   * which is how those rows keep the browser's own.
   *
   * Empty for the other two non-editable sections: the capture zone has no entries to match,
   * and the repositories draw no tree.
   */
  const songActions = useMemo<TreeAction<TreeNode>[]>(
    () =>
      section !== "songs"
        ? []
        : [
            {
              key: "add-variant",
              // The same gesture as the drop onto this row, said in words — a drag is not
              // discoverable, and this is the family whose tree refuses every other write.
              label: "Ajouter une variante…",
              when: (t) => isSongFolder(entries, t.path),
              run: (t) => pickVariant(t.path),
            },
            {
              key: "queue-song",
              // La file d'attente de la barre du bas, pas une playlist : ce qu'on écoute
              // maintenant, dans cet onglet, par opposition au fichier YAML qu'est une
              // playlist. Voir ../docs/miniPlayer.md.
              label: "Ajouter à la liste de lecture",
              // Seulement ce qui a réellement un master : mettre à la suite un dossier que
              // personne n'a rempli ferait une ligne que la lecture sauterait en silence.
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
              // Named, and named as a folder: what goes is the master and its sidecar, not
              // just the row. There is no confirmation, as everywhere else in this menu.
              label: (t) => `Supprimer ${t.name}`,
              when: (t) => isSongFolder(entries, t.path),
              danger: true,
              // A song is a folder on disk though a leaf in the tree — the single-file route
              // would leave the folder, and with it a song the scan still finds.
              run: (t) =>
                void library
                  .removeTree(`${section}/${t.path}`)
                  .then(() => {
                    // Close the editor when it is showing what just went. It would empty
                    // itself once the poll lands, but on an address naming a deleted file.
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

  /**
   * The repositories' own reload. Its own SERVICE, not just its own route — hence its own
   * poll below rather than a third branch inside the catalogue's.
   *
   * `loud` is whether a failure is worth an error banner: this now runs on EVERY section, and
   * a repository service that is down must not put a red message across Morceaux. On the
   * Projets section it is the screen's own subject, so there it speaks.
   */
  const loadProjects = useCallback(async (rev: string, loud: boolean) => {
    try {
      const { repos: list } = await projects.list();
      seen.current[PROJECTS_SECTION] = rev;
      setRepos(list);
      // Les PROJETS et non les dépôts — c'est ce que l'onglet nomme. Voir projects/count.ts.
      setCounts((c) => ({ ...c, [PROJECTS_SECTION]: projectCount(list) }));
      if (loud) setError(null);
    } catch (e) {
      if (loud) setError((e as Error).message);
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

  /**
   * Changer de section jette ce qu'on tenait — ET le jeton qui prétendait qu'il était à jour.
   *
   * `entries` ne contient qu'UNE section à la fois, donc dès qu'on en change, le jeton de
   * révision de la nouvelle section est un mensonge : il dit « rien n'a bougé depuis la
   * dernière fois », ce qui est vrai du VOLUME et faux de l'écran, qui ne tient plus rien.
   * Le poll ci-dessous ne rechargeait alors pas, et le spinner tournait indéfiniment — jusqu'à
   * un rechargement de page, qui repart avec des jetons vides. C'était le symptôme.
   *
   * Ici, sur `section`, et pas dans le clic d'onglet : le bouton « précédent » et un lien
   * profond changent de section sans passer par lui (voir useLibraryRoute).
   */
  useEffect(() => {
    setEntries(null);
    setUnlisted([]);
    setPicked(null);
    seen.current[section] = "";
  }, [section]);

  // One poll drives every section OF THE LIBRARY: fetch the token map, and reload the
  // SELECTED one only if its token moved. A section nobody is looking at just updates its
  // count on switch. The zone is in that map beside the families, so there is still exactly
  // one poll for everything the volume holds.
  useEffect(() => {
    if (isProjects || isEngine || isFind) return; // not on the volume — nothing of theirs to poll here
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
  }, [isEngine, isFind, isProjects, isZone, load, loadZone, section]);

  // The repositories' poll, separate because they come from a DIFFERENT service. Folding them
  // into the loop above would make every library tick depend on `/api/projects` answering,
  // and a git fetch that hangs would stop the catalogue from refreshing.
  // Sur TOUTE section, et pas seulement la sienne : le badge de l'en-tête annonce un nombre en
  // permanence, donc il doit être connu en permanence. Gardé derrière `isProjects`, il valait
  // zéro partout ailleurs — un chiffre faux, pas un chiffre absent.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await projects.revision();
        if (stop) return;
        if (seen.current[PROJECTS_SECTION] !== revision)
          await loadProjects(revision, isProjects);
      } catch (e) {
        if (!stop && isProjects) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [isProjects, loadProjects]);

  return (
    /* Wrapping the whole shell, because what plays must outlive every screen inside it — and
       because it holds this tab's ONE engine socket, which the editors below borrow rather
       than each opening their own. */
    <PlaybackProvider
      engineId={choice.chosenId}
      playQueue={playQueue}
      // Pour la destination « les enceintes de la machine » : c'est son service de fichiers
      // qui pilote son mpv. Voir playback/targets.ts.
      machine={{ fileBase: choice.fileBase, token: choice.token }}
    >
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* The families moved from the side to the header, where l8 puts its views: the
          side is worth more as the current zone's tree than as three fixed buttons. */}
        <header className="flex items-center gap-4 border-b px-6 py-2">
          <span className="text-lg font-semibold tracking-tight">st0</span>
          <nav className="flex items-center gap-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                // Rien à vider ici : changer de section suffit, et l'effet qui suit
                // `section` s'en charge — y compris quand c'est le bouton « précédent » ou un
                // lien profond qui en change, ce que ce gestionnaire ne voit pas.
                onClick={() => setSection(id)}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                  section === id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                <span className="tabular-nums text-xs">{counts[id] ?? 0}</span>
              </button>
            ))}
          </nav>
          {/* Chaque section que l'arbre ne sait pas écrire a son bouton ici : les morceaux
            parce que leur arborescence est déduite des tags, les enregistrements parce qu'un
            enregistrement est nommé par l'horloge. Voir docs/songs.md et docs/recordings.md. */}
          <div className="ml-auto flex items-center gap-3">
            {section === "songs" ? (
              <>
                {/* À côté d'« Ajouter », pas à sa place : déposer un fichier qu'on a déjà et
                    aller en chercher un qu'on n'a pas sont deux gestes, et celui-ci ne
                    remplace pas l'autre. Il MÈNE à une page — l'historique s'allonge — au
                    lieu d'ouvrir un dialogue. Voir docs/hunt.md. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSection("find")}
                >
                  <Search className="mr-1 h-4 w-4" /> Trouver des morceaux
                </Button>
                <AddSong onDone={refresh} engine={choice} />
              </>
            ) : null}
            {isZone ? (
              <AddRecording onDone={refresh} onError={setError} />
            ) : null}
            <span className="text-xs tabular-nums text-muted-foreground">
              {VERSION}
            </span>
          </div>
          {/* The way out to the studio's other apps. First of the three icon buttons because
            it is the only one that LEAVES: the two beside it change how this page behaves. */}
          <OtherApps />
          {/* Where sound comes out, beside the cog rather than inside it: it is changed while
            listening — you hear it on the wrong machine and reach for it — whereas the cog
            holds things you set once. Its own button so it is one click, and its icon says
            the current answer without opening anything. */}
          <PlaybackPicker
            target={playback.target}
            engineReady={choice.ready}
            onChoose={playback.choose}
          />
          {/* One cog for the two things that belong to the person rather than the library:
            which engine auditions a module, and signing out. One place, and it stays
            reachable while the editor is open — which is why the pick is threaded into it
            rather than read once: see useModuleEngine. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Réglages">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Moteur</DropdownMenuLabel>
              <div className="px-2 pb-2">
                <EnginePicker
                  ranked={choice.ranked}
                  chosenId={choice.chosenId}
                  onChoose={choice.choose}
                  onRetry={choice.refresh}
                />
              </div>
              {/* The page behind the picker: the tray's engine options, in the browser. */}
              <DropdownMenuItem
                onSelect={() => {
                  setSection("engine");
                  setPicked(null);
                }}
              >
                <Activity className="mr-2 h-4 w-4" />
                État du moteur
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void auth.logout()}>
                <LogOut className="mr-2 h-4 w-4" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* The engine page draws edge to edge for the same reason the repositories do:
          nothing it shows is on the volume. */}
        {isEngine ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <EnginePage choice={choice} />
          </div>
        ) : /* La recherche de morceaux dessine sa propre page, pour la même raison : son
          historique ne vient pas du volume, et il peut être long. */
        isFind ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <FindSongs
              onBack={() => setSection("songs")}
              onFiled={refreshSongs}
            />
          </div>
        ) : /* The repositories draw the whole row themselves: there is no library tree to put
          down the side, because nothing here is on the volume. */
        isProjects ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <ProjectsSection
              repos={repos}
              busy={present === null && repos.length === 0}
              // The open repository is in the ADDRESS, in the same slot a module's file uses —
              // so a link to one survives a reload. See routes.ts.
              openId={file}
              // Créer et supprimer un projet se font sur la machine, pas ici — voir
              // projects/machine.ts et ../../docs/projects.md.
              machine={choice}
              onOpen={(id) => setFile(id)}
              onChanged={() => {
                // Force the next tick to reload: the write moved the revision, but waiting a
                // whole poll for a click you just made reads as the click not working.
                seen.current[PROJECTS_SECTION] = "";
              }}
            />
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* MODULES is gated on a live engine. Not a nag: a module is what a plugin is, and
            only a loaded plugin can say what its parameters are called, what they span and
            what presets it ships. Without one the builder edits YAML blind — every binding
            typed from memory, every range guessed — which is worse than being told to pick
            an engine first. The header stays reachable above this, so the other sections
            are one click away.

            Not over the EDITOR, which has always been reachable past this gate — a deep link
            opened one before the gate existed, and the builder says for itself, in its
            footer, that an absent engine leaves the plugin's parameters empty. */}
            {!editing &&
              section === "modules" &&
              choice.loaded &&
              !choice.ready && (
                <div className="absolute inset-0 z-20 flex items-start justify-center overflow-auto bg-background/95 p-8">
                  <Card className="w-full max-w-md space-y-3 p-5">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <Boxes className="h-4 w-4" /> Un moteur est nécessaire
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Les modules se construisent contre un greffon chargé :
                      c'est lui qui donne les noms des paramètres, leurs bornes
                      et ses presets d'usine. Sans moteur, l'éditeur ne peut que
                      deviner.
                    </p>
                    <div className="rounded-md border p-1">
                      <EngineList
                        ranked={choice.ranked}
                        chosenId={choice.chosenId}
                        onChoose={choice.choose}
                        onRetry={choice.refresh}
                      />
                    </div>
                    {/* The remembered choice pointing at a machine that is off is the case a bare
                  "aucun moteur" would hide — say which, so the answer is "turn it on". */}
                    {choice.chosenId && (
                      <p className="text-xs text-muted-foreground">
                        Le moteur retenu ne répond pas depuis ce navigateur.
                      </p>
                    )}
                  </Card>
                </div>
              )}
            {/* The zone being explored, as a tree: /songs, /samples or /modules. Same
            component l8 uses for a workspace, fed from the entry paths. */}
            <aside className="w-60 shrink-0 overflow-auto border-r p-2">
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
                  const dir = pickInto.current;
                  e.target.value = "";
                  if (files.length)
                    void library
                      .uploadTree(dir ? `${section}/${dir}` : section, files)
                      .then(refresh)
                      .catch((err: Error) => setError(err.message));
                }}
              />
              {/* …and the one the variant menu opens. Its own input and not the folder picker's:
                  that one names a directory, and a variant is one audio file. */}
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
                // The family IS the root: rootPath is what a drop onto empty space and the
                // background menu target, and every node path below is relative to it.
                rootPath=""
                rootLabel={section.toUpperCase()}
                // The entry being edited outranks the merely selected one: it is what the middle
                // of the screen is showing, and the tree is now beside it rather than replaced.
                // Same value `revealed` follows, so the marked row and the opened branch agree.
                activePath={target}
                // Open down to it, so a reloaded deep link lands on a tree showing where it is
                // rather than one collapsed to the root. Sticky — see `revealed`.
                reveal={revealed}
                // A MODULE is a row you edit: clicking it opens the builder, on the PANEL, which is
                // what people come to this screen for and what the "Éditer" button already chose.
                // Anything else just selects.
                // A module is a folder row you OPEN: its chevron unfolds the assets, its name opens
                // the builder. Without this the click would only fold it, and the one gesture this
                // screen exists for would need a second one to reach.
                opensOnName={(n) =>
                  isModuleFolder(entries, n.path) ||
                  isSongFolder(entries, n.path)
                }
                onOpen={(n) => {
                  // A VARIANT row opens its SONG: it is a line of that sidecar, and the editor
                  // showing the sidecar is where it can be renamed, re-pointed or removed.
                  const v = variantAt(entries, n.path);
                  if (v)
                    return openFile(`${relative(v.song.path)}/${SONG_FILE}`);
                  const entry = entryAt(entries, n.path);
                  if (!entry) return;
                  if (holdsModuleFile(entry)) openFile(`${n.path}/${UI_FILE}`);
                  // A chain has one file, so the address names it rather than a pane.
                  else if (holdsChainsFile(entry))
                    openFile(`${n.path}/${CHAINS_FILE}`);
                  // …and a song names its sidecar, which is the left half of what opens.
                  else if (isSong(entry)) openFile(`${n.path}/${SONG_FILE}`);
                  // A playlist names NOTHING extra: the row already is the file, so the path
                  // the tree hands over is the whole of the address.
                  else if (isPlaylist(entry)) openFile(n.path);
                  else setPicked(entry);
                }}
                // A module, a chain and a song each wear the glyph of their own tab. Without one
                // the row would read as a plain file, which is the one thing none of them is.
                // A variant wears the two SongVariants draws, for the same reason it draws them:
                // a sibling file and a chain are different things to go looking for.
                icon={(n) => {
                  const v = variantAt(entries, n.path);
                  if (v)
                    return v.variant.kind === "file" ? (
                      <AudioLines className="h-4 w-4 shrink-0" />
                    ) : (
                      <Workflow className="h-4 w-4 shrink-0" />
                    );
                  const e = entryAt(entries, n.path);
                  if (e && holdsModuleFile(e))
                    return <Boxes className="h-4 w-4 shrink-0" />;
                  if (e && holdsChainsFile(e))
                    return <Workflow className="h-4 w-4 shrink-0" />;
                  if (e && isSong(e))
                    return <Disc3 className="h-4 w-4 shrink-0" />;
                  if (e && isPlaylist(e))
                    return <ListMusic className="h-4 w-4 shrink-0" />;
                  return null;
                }}
                // Absent for songs, which is why the header has a button instead: a file
                // dropped here would land where it fell, and that family's shape is deduced
                // from tags rather than chosen. Undefined and not a no-op — the shared tree
                // reads these props to decide whether a row is even a drop target.
                // onDropTree and not onDropFiles: a module IS a folder, so dropping one has to
                // arrive as a folder. `dataTransfer.files` cannot carry that — see the shared
                // tree's lib/droppedEntries.ts for why, and for the two traps it works around.
                // A drop ONTO a module is a drop into what it carries: the module folder itself holds
                // its definition, and a sample landing beside module.yaml is neither an instance nor a
                // panel — it is material, and `assets/` is where the loader looks for it.
                // A drop in SONGS is a variant, and only onto the morceau itself: the rows above
                // it are an artist and an album, which are deduced from tags and hold nothing.
                // The shared tree decides whether a row is a target from this prop alone — it
                // has no per-row test — so those rows do highlight, and this says why nothing
                // landed instead of swallowing the drop.
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
                // Present, so rows are draggable — the shared tree decides that from this prop
                // alone. Folders included: `moveEntry` renames a directory as readily as a file,
                // and a folder is a real row now rather than a shared prefix across entry paths.
                onMove={
                  editable
                    ? (from, toDir) =>
                        void library
                          .move(
                            `${section}/${from}`,
                            // Through the same mapping a drop goes through: dragging a sample onto a
                            // module has to mean what dropping one there means.
                            `${assetsTarget(toDir)}/${from.split("/").pop()}`,
                          )
                          .then(refresh)
                          .catch((e: Error) => setError(e.message))
                    : undefined
                }
                cancelLabel="Annuler"
                // Every target needs at least one action that passes its `when`, or the menu
                // does not open AT ALL — the shared tree returns early rather than showing an
                // empty one. Folders and the root would otherwise have none, since the two
                // below are file-only. The zone and the repositories lean on that same early
                // return: no menu opens at all there.
                //
                // SONGS get one action and only one — see `songActions`. That family's tree
                // still cannot write, which is what `editable` says and why the branch is not
                // simply `editable ? all : none`.
                actions={
                  !editable
                    ? songActions
                    : [
                        {
                          key: "upload-folder",
                          label: "Téléverser un dossier…",
                          when: (t) =>
                            (t.dir || t.root) &&
                            !isModuleFolder(entries, t.path),
                          run: (t) => pickFolder(t.path),
                        },
                        {
                          key: "new-folder",
                          label: "Nouveau dossier…",
                          // Anywhere but INSIDE a module: a module holds its own files and its
                          // instances, never folders. Depth is not this menu's business — the
                          // scanner finds a module wherever its file is.
                          when: (t) =>
                            (t.dir || t.root) &&
                            !isModuleFolder(entries, t.path),
                          prompt: { placeholder: "nom", submit: "Créer" },
                          run: (t, value) =>
                            void library
                              .newFolder(
                                `${section}/${t.path ? `${t.path}/` : ""}${value}`,
                              )
                              .then(refresh)
                              .catch((e: Error) => setError(e.message)),
                        },
                        {
                          key: "new-playlist",
                          label: "Nouvelle playlist…",
                          // Its own action beside the generic "Nouveau fichier…", which would
                          // create an EMPTY one: the right-hand pane is drawn from the text, so
                          // a blank file opens on a parse failure for a playlist nobody has had
                          // a chance to get wrong yet. This writes the stub instead.
                          when: (t) =>
                            section === "playlists" && (t.dir || t.root),
                          prompt: { placeholder: "nom", submit: "Créer" },
                          run: (t, value) => {
                            // The extension is what makes the file a playlist (there is no
                            // marker inside one), so it is added rather than demanded.
                            const name = /\.ya?ml$/i.test(value)
                              ? value
                              : `${value}${PLAYLIST_EXT}`;
                            const rel = `${t.path ? `${t.path}/` : ""}${name}`;
                            void library
                              .writeFile(
                                `${section}/${rel}`,
                                playlistStub(value.replace(/\.ya?ml$/i, "")),
                              )
                              // Straight into it: an empty playlist exists to be filled, and
                              // the screen that fills it is one click away otherwise.
                              .then(() => openFile(rel))
                              .then(refresh)
                              .catch((e: Error) => setError(e.message));
                          },
                        },
                        {
                          key: "new-file",
                          label: "Nouveau fichier…",
                          // Not inside a MODULE, folder though its row now is: the tree draws a
                          // module's assets and nothing else, so a file created beside module.yaml
                          // would answer 200 and appear nowhere. The builder makes those.
                          when: (t) =>
                            (t.dir || t.root) &&
                            !isModuleFolder(entries, t.path),
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
                          // Only on a CATEGORY folder, which is what makes the category chosen by where
                          // you clicked rather than by a second prompt — and `io` never offers it,
                          // because it is the engine's own IN/OUT and no scanned plugin is one.
                          key: "engine-face",
                          label: "Nouveau module depuis un greffon…",
                          // Any folder under a type, at any depth — the module lands where you
                          // clicked. Never inside a module: a module holds files, not modules.
                          when: (t) =>
                            section === "modules" &&
                            t.dir &&
                            !isModuleFolder(entries, t.path) &&
                            FACE_CATEGORIES.includes(t.path.split("/")[0]),
                          prompt: {
                            placeholder:
                              "nom du greffon, tel que le moteur le rapporte",
                            submit: "Créer",
                            // Re-evaluated on every keystroke, which is what turns a blind field
                            // into a picker without a list widget: the machine's scan IS the
                            // vocabulary, so matching against it is the difference between naming
                            // a plugin and guessing at one.
                            hint: (_t, value) => {
                              if (!plugins.length)
                                return "cette machine n'a rapporté aucun greffon scanné";
                              const q = value.trim().toLowerCase();
                              if (!q)
                                return `${plugins.length} greffons scannés`;
                              const hits = plugins.filter((p) =>
                                p.toLowerCase().includes(q),
                              );
                              return hits.length
                                ? hits.slice(0, 4).join(" · ")
                                : "aucun greffon de ce nom";
                            },
                          },
                          run: (t, value) => {
                            // Checked against the scan rather than taken on trust. A name that
                            // matches nothing writes a module whose `extends` names a ref that does
                            // not exist — and a dangling `extends` costs the inheritance silently
                            // (resolveModule returns the child), so it would surface much later,
                            // as a module that mysteriously loads no plugin.
                            const named = plugins.find(
                              (p) =>
                                p.toLowerCase() === value.trim().toLowerCase(),
                            );
                            if (plugins.length && !named) {
                              setError(
                                `« ${value} » n'est pas un greffon que cette machine a scanné.`,
                              );
                              return;
                            }
                            let face: ReturnType<typeof engineFaceModule>;
                            try {
                              // The CATEGORY is the type folder — it decides the module's ports and
                              // its kind — while the module lands in the folder that was clicked,
                              // which may be a category below it.
                              face = engineFaceModule(
                                named ?? value,
                                t.path.split("/")[0],
                              );
                            } catch (e) {
                              setError((e as Error).message);
                              return;
                            }
                            const dir = `${t.path}/${face.module}`;
                            void library
                              .writeFile(
                                `${section}/${dir}/${MODULE_FILE}`,
                                face.text,
                              )
                              // Straight into the builder, on the PANEL: drawing the face is the only
                              // reason this module exists — everything it does comes from `extends`.
                              .then(() => openFile(`${dir}/${UI_FILE}`))
                              .then(refresh)
                              .catch((e: Error) => setError(e.message));
                          },
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
                          // A CHAIN is the row that is a folder on disk and a leaf in the tree, so
                          // asking `t.dir` alone would delete it with the single-file route and
                          // leave the folder behind. A module answers both since it holds assets.
                          run: (t) =>
                            void (
                              t.dir ||
                              isModuleFolder(entries, t.path) ||
                              holdsChain(entries, t.path)
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

            {/* The editor takes the middle, not the screen. It still wants both halves of what
            it gets — text and grid, each with its own pane underneath — which is why it is
            the tree, and only the tree, that stays beside it. */}
            {editing ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ModuleEditor
                  entry={editing.entry}
                  pane={editing.pane}
                  onBack={() => openFile(null)}
                />
              </main>
            ) : editingChain ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChainEditor
                  entry={editingChain}
                  vimMode={localStorage.getItem("st0.vim") === "1"}
                  onBack={() => openFile(null)}
                  onSaved={refresh}
                />
              </main>
            ) : editingSong ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SongEditor
                  entry={editingSong}
                  vimMode={localStorage.getItem("st0.vim") === "1"}
                  fileBase={choice.fileBase}
                  engineToken={choice.token}
                  playbackTarget={playback.target}
                  onBack={() => openFile(null)}
                  onSaved={refresh}
                />
              </main>
            ) : editingPlaylist ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <PlaylistEditor
                  entry={editingPlaylist}
                  vimMode={localStorage.getItem("st0.vim") === "1"}
                  playbackTarget={playback.target}
                  engineToken={choice.token}
                  onBack={() => openFile(null)}
                  onSaved={refresh}
                />
              </main>
            ) : (
              <main className="min-w-0 flex-1 overflow-auto p-6">
                {error ? (
                  <Card className="p-4 text-sm text-destructive">{error}</Card>
                ) : present === false ? (
                  // A real answer, not a failure: the volume is mounted but nothing is in it yet.
                  <Card className="p-6 text-sm text-muted-foreground">
                    La médiathèque est vide pour l'instant.
                  </Card>
                ) : isZone ? (
                  // The zone's own view: the captures by day, newest first. No entry columns —
                  // a capture has no title, no artist and no kind, which is exactly why it is
                  // not a catalogue entry. See packages/mediatek/docs/recordings.md.
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
                        // A song OPENS, the way its tree row does — the middle list and the tree
                        // are the same rows twice, and a click that meant two things depending on
                        // which copy you hit is the one thing they must not do. Everything else
                        // still just selects, which is what the panes beside this read.
                        onClick={() =>
                          isSong(e)
                            ? openFile(`${relative(e.path)}/${SONG_FILE}`)
                            : // A playlist opens for the same reason, and names nothing extra:
                              // the entry IS the file.
                              isPlaylist(e)
                              ? openFile(relative(e.path))
                              : setPicked((p) => (p?.id === e.id ? null : e))
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {e.name}
                        </span>
                        {/* Not filed: found on disk with no sidecar. Worth SAYING rather than hiding.
                        Never a module now — a folder without a module.yaml is a folder, and the
                        catalogue holds only modules (see scan.ts). */}
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
                        {/* How long a playlist is — the one fact about one worth having before
                            opening it, the way `pack` is for a sample. Its `kind` is empty, so
                            the column on the right says nothing about this family. */}
                        {isPlaylist(e) ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {Number(e.meta?.items ?? 0)} morceaux
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

            {/* Only for modules: it is the one family with a plugin behind it, and the engine
            is the only thing that knows what that plugin's parameters are called. Never
            beside the editor, which has a parameters pane of its own — two lists of the same
            thing, and the width belongs to the one you can drag onto a widget. */}
            {!editing && section === "modules" && picked ? (
              <aside className="w-96 shrink-0 overflow-auto border-l p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {picked.name}
                  </span>
                  <Button
                    size="sm"
                    // The PANEL, which is what people come to this screen for — and the address
                    // says so, rather than naming the module and hiding which pane is showing.
                    onClick={() =>
                      openFile(`${relative(picked.path)}/${UI_FILE}`)
                    }
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Éditer
                  </Button>
                </div>
                <ModuleParams entry={picked} />
              </aside>
            ) : null}

            {/* A song's variants used to be a fourth column here, shown only while nothing was
            open. Clicking a song now OPENS it, so that condition could never be met again —
            they moved under the player in SongEditor, which is where they belonged anyway:
            the master and its alternative versions are the same question. */}
          </div>
        )}

        {/* What is playing. It belongs to the TAB rather than to any screen, which is why it is
          drawn here and not inside a song's editor: absent until something plays, and it stays
          after the song ends. Above the status bar, which stays the app's last line — one is a
          thing you act on, the other a line you read. See docs/miniPlayer.md. */}
        {/* Ne dessine rien : c'est l'enchaînement de la file. DANS le provider, parce qu'il
            lui faut le transport, et ici parce qu'il lui faut aussi la machine choisie et la
            destination — c'est ce couple qui dit OÙ un fichier se joue. */}
        <QueueAdvance
          machine={{
            fileBase: choice.fileBase,
            token: choice.token,
            ready: choice.ready,
          }}
          target={playback.target}
        />
        <MiniPlayer />

        {/* The status bar. Outside the row above so it spans the whole width, under the tree
          and the editor alike: what it says — which engine, and how good the link is — is a
          property of the session, not of whichever pane is open. */}
        <EngineStatusBar choice={choice} />
      </div>
    </PlaybackProvider>
  );
}
