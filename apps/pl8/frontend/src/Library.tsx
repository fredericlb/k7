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
  DropdownMenuLabel,
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
  Activity,
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
import { auth, engineMachine, library } from "./api";
import { folderAt } from "./assetTree";
import { EngineStatusBar } from "./EngineStatusBar";
import { EnginePage } from "./engine/EnginePage";
import { EnginePicker } from "./engine/EnginePicker";
import { useEngineChoice } from "./engine/useEngineChoice";
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

/** The five that ARE families — the only ids `/list` and `/manifest` accept. Subtracted rather
 *  than listed, so a new family is one entry in `SECTION_IDS`; the cost is that every section
 *  which is NOT one has to be named here, or it silently becomes a family the poll would ask
 *  the server for. */
type FamilyId = Exclude<SectionId, typeof RECORDINGS_DIR | "engine" | "find">;

/** Poll interval for the revision map. Cheap on the server (a walk per family, only when
 *  something moved) and slow enough that a library nobody is touching costs nothing. */
const POLL_MS = 3000;

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

// The three files a module is, the `PANE_OF` map from the address to the builder's pane, and
// `holdsModuleFile` / `holdsChainsFile` — the two rows that were a folder on disk and a leaf in
// the tree — all stood here. They went with the families.

/** Is this entry a SONG? The family alone answers, unlike the two above: a song folder is
 *  what the scan stopped at, so every entry in the family is one — sidecar or not. A folder
 *  with no `song.yaml` is `catalogued: false`, which is a song nobody filed, not a category. */
const isSong = (e: MediatekEntry): boolean => e.family === "songs";

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

/**
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
 * definition (module.yaml, the panel, the shelf, its nodes) stays behind one row that opens the
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
        // A SONG folds for neither reason: it holds its variants, and a file dropped on it
        // becomes one — which needs a row that is a drop target, and the shared tree only
        // makes folders into those.
        const folds = leaf && e.family !== "songs";
        node = folds
          ? { name: part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
        // A module's children: what its `assets/` folder holds, nested as it is on disk — a NAM
        // pack is a folder per amp. Named at their real path, so a drop, a rename and a delete
        // all address the file that is actually there. See assetTree.ts.
        // A song's children: the versions its sidecar declares. Named by that sidecar and NOT
        // by a file, because half of them are not files — a chain variant names a template in
        // another family — so the name is the one thing every variant has and the only one
        // that is unique within a song. The path is therefore an identity, the way the
        // synthesised root's is, and nothing addresses it as a file. See variantAt.
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
  // The cog's engine-status page — a section with no tab, no tree and no library poll:
  // everything it shows comes from the engine's own socket. See engine/EnginePage.tsx.
  const isEngine = section === "engine";
  // « Trouver des morceaux » — même forme que la page moteur : une section sans onglet, atteinte
  // par un bouton depuis Morceaux, qui dessine bord à bord. Rien de ce qu'elle montre n'est sur
  // le volume non plus : l'historique vient de `/api/hunt`. Voir ../../docs/hunt.md.
  const isFind = section === "find";
  /**
   * Y a-t-il un arbre à côté ? Les trois sections ci-dessus dessinent toute la largeur
   * elles-mêmes, parce que rien de ce qu'elles montrent n'est sur le volume.
   *
   * Dérivé ici et non dans la branche qui le rend, parce que l'EN-TÊTE en a besoin : c'est
   * lui qui porte le bouton du tiroir, et il est au-dessus de la branche.
   */
  const hasTree = !isEngine && !isFind;
  // Le tiroir de l'arborescence sur écran étroit. Fermé au départ : sur un téléphone, ce
  // qu'on veut voir en arrivant est le contenu, pas la façon d'y naviguer.
  const [treeOpen, setTreeOpen] = useState(false);
  // Whether the TREE may write. Two sections say no, for two different reasons: `songs/`
  // has a shape deduced from tags — a folder made by hand there is not a badly filed
  // song, it is an invisible one — and a capture is named by the clock, so a renamed one
  // would be a capture at an hour it was not made. Both have a header button instead; see
  // packages/mediatek/docs/songs.md and docs/recordings.md.
  const editable = section !== "songs" && !isZone;
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  // What no entry accounts for — an empty folder, a loose file. It cannot be inferred from
  // the entry paths, which is the whole point, so the service lists it and the tree draws it.
  const [unlisted, setUnlisted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // What a bulk action just DID. An outcome and not a fault, so it must not be said in the
  // destructive card next door — "les 252 greffons ont déjà un module ici" is the ordinary
  // second run of an idempotent pass, and reading it in red would say the opposite.
  const [notice, setNotice] = useState<string | null>(null);
  // The capture zone's own listing. Held APART from `entries` because it is apart: nothing
  // here is a catalogue entry, and it arrives from its own route.
  const [recordings, setRecordings] = useState<RecordingDay[]>([]);
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
  const editingSong = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && isSong(entry) ? entry : null;
  }, [entries, file]);
  /** What is open. What the tree marks active and opens down to, and what the middle of the
   *  screen is showing — three questions with one answer. A playlist was the other answer here
   *  until it moved to the workspace and to st0 (see routes.ts). */
  const opened = editingSong;
  /** Where a drop lands, family-relative. It used to re-root a drop onto a MODULE into that
   *  module's `assets/`; nothing on this volume is a module any more. */
  const assetsTarget = useCallback(
    (dir: string): string => (dir ? `${section}/${dir}` : section),
    [section],
  );
  /** Open the screen on a song's sidecar, or close it. The URL is the only writer. */
  const openFile = useCallback((rel: string | null) => {
    setFile(rel);
    // Le tiroir se referme sur ce qu'on vient d'ouvrir : il recouvre l'écran, et le laisser
    // ouvert cacherait exactement ce qu'on a demandé à voir.
    setTreeOpen(false);
  }, []);
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
  const target = opened ? relative(opened.path) : null;
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
  // The machine's plugin scan was read here, so every scanned plugin could be given a
  // module in the library. That pass went with the `modules` family.

  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});

  // The folder PICKER, beside the drag: a drag-and-drop that fails does so silently, which is a
  // bad only-way-in. `webkitdirectory` is the input's property, not the click's, hence a
  // dedicated hidden input; `webkitRelativePath` is what it fills.
  const pickRef = useRef<HTMLInputElement>(null);
  // The RESOLVED target, not the row that was clicked: a module's row means its `assets/`, and
  // mapping it here keeps the picker and the drop landing in the same place.
  const pickInto = useRef<string>("");
  const pickFolder = (dir: string) => {
    pickInto.current = assetsTarget(dir);
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

  // A module's `ui.yaml` is DRAWN, never generated. There was a pass here that built one from
  // the plugin's parameter list; it went, because a generated panel can only ever be knobs and
  // dropdowns — `fader`, `meter`, `filepicker`, a rowSpan, an arrangement that means something —
  // are all things a person puts there and a parameter list cannot imply. Run over a library it
  // turned a mixer's channel strip into five knobs in a row. The builder's grid is the way in.

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
   * Empty for the capture zone too, which has no entries to match.
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
    setNotice(null);
    setTreeOpen(false);
    seen.current[section] = "";
  }, [section]);

  // One poll drives every section OF THE LIBRARY: fetch the token map, and reload the
  // SELECTED one only if its token moved. A section nobody is looking at just updates its
  // count on switch. The zone is in that map beside the families, so there is still exactly
  // one poll for everything the volume holds.
  useEffect(() => {
    if (isEngine || isFind) return; // not on the volume — nothing of theirs to poll here
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
  }, [isEngine, isFind, isZone, load, loadZone, section]);

  // The repositories had a SECOND poll here, on `/api/projects` and `/api/shares`, running on
  // every section because the tab's badge had to hold a number at all times. Both are st0's home
  // page now, so this screen is back to one poll for one volume — which is the shape the comment
  // above always claimed. The routes are untouched and still this service's; only the caller
  // moved. See apps/st0/frontend/docs/projects.md.

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
        {/* The families moved from the side to the header, where st0 puts its views: the
          side is worth more as the current zone's tree than as three fixed buttons.
          La barre elle-même est celle de @frediverse/ui : elle porte la bande d'onglets, le
          point de bascule et le hamburger. Ce qui reste ici est ce que pl8 met dedans.
          Le nom de la SECTION est le sous-titre — sur un écran étroit, savoir où l'on est vaut
          plus que savoir quelle app on regarde, et un hamburger seul ne le dit pas. */}
        <AppHeader
          // No `variant`: the house look, the accent tinted over the page. It was `plain`
          // when the alternative was a solid accent bar — see @frediverse/ui's docs/app-header.md.
          title="pl8"
          subtitle={sectionLabel(section)}
          items={sectionItems(section, counts, setSection)}
          className="z-20"
          actions={
            <>
              {/* L'arborescence, sur écran étroit seulement : elle occupe 240 px fixes, ce qui ne
              laisse rien au contenu sur un téléphone. Elle devient un tiroir, et ce bouton est
              la seule façon de l'ouvrir. Absent là où il n'y en a pas — les dépôts, le moteur
              et la recherche dessinent toute la largeur eux-mêmes. */}
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
              {/* Chaque section que l'arbre ne sait pas écrire a son bouton ici : les morceaux
            parce que leur arborescence est déduite des tags, les enregistrements parce qu'un
            enregistrement est nommé par l'horloge. Voir docs/songs.md et docs/recordings.md.
            Plus de `ml-auto` : la barre partagée pousse déjà ses actions à droite. */}
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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
                      {/* L'icône seule quand la place manque : le bouton reste atteignable, et
                      c'est la phrase qui coûte les cent pixels dont l'en-tête manque. */}
                      <Search className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">
                        Trouver des morceaux
                      </span>
                    </Button>
                    <AddSong onDone={refresh} engine={choice} />
                  </>
                ) : null}
                {isZone ? (
                  <AddRecording onDone={refresh} onError={setError} />
                ) : null}
                {/* La version part avant tout le reste : c'est la seule chose ici dont on n'a
                jamais besoin dans l'instant. */}
                <span className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
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
            </>
          }
        />

        {/* The engine page draws edge to edge, because nothing it shows is on the volume. */}
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
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* An engine gate stood here, over the Modules section: a module is what a plugin
            is, and only a loaded plugin can say what its parameters are called. The gate went
            when the builder did, the read-only view went with the family, and now the section
            itself is gone. Modules are st0's, in the Libraries tab of whatever project is open. */}
            {/* Le voile du tiroir. Il ferme au clic, et il n'existe qu'ouvert : un élément
                invisible qui couvre l'écran est un élément qui avale les clics. */}
            {treeOpen && (
              <button
                type="button"
                aria-label="Fermer l'arborescence"
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setTreeOpen(false)}
              />
            )}
            {/* The zone being explored, as a tree: /songs or /samples. Same
            component st0 uses for a workspace, fed from the entry paths.

            En colonne dès qu'il y a la place, en TIROIR quand il n'y en a pas : 240 px fixes
            ne laissent rien au contenu sur un téléphone. Le même balisage dans les deux cas —
            l'extraire dans un composant à part pour le rendre deux fois aurait dupliqué les
            deux cents lignes d'actions qu'il porte. */}
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
                  // Already section-prefixed and already mapped through `assetsTarget` — see
                  // `pickFolder`, which is the only writer.
                  const target = pickInto.current;
                  e.target.value = "";
                  if (files.length)
                    void library
                      .uploadTree(target, files)
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
                // A SONG is a folder row you OPEN: its chevron unfolds its versions, its name
                // opens its sidecar. Anything else just selects.
                opensOnName={(n) => isSongFolder(entries, n.path)}
                onOpen={(n) => {
                  // A VARIANT row opens its SONG: it is a line of that sidecar, and the editor
                  // showing the sidecar is where it can be renamed, re-pointed or removed.
                  const v = variantAt(entries, n.path);
                  if (v)
                    return openFile(`${relative(v.song.path)}/${SONG_FILE}`);
                  const entry = entryAt(entries, n.path);
                  if (!entry) return;
                  // A song names its sidecar, which is the left half of what opens.
                  if (isSong(entry)) openFile(`${n.path}/${SONG_FILE}`);
                }}
                // A song wears the glyph of its own tab. Without one the row would read as a
                // plain file, which is the one thing it is not. A variant wears the two
                // SongVariants draws, for the same reason it draws them.
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
                // Absent for songs, which is why the header has a button instead: a file
                // dropped here would land where it fell, and that family's shape is deduced
                // from tags rather than chosen. Undefined and not a no-op — the shared tree
                // reads these props to decide whether a row is even a drop target.
                // onDropTree and not onDropFiles: a module IS a folder, so dropping one has to
                // arrive as a folder. `dataTransfer.files` cannot carry that — see the shared
                // tree's lib/droppedEntries.ts for why, and for the two traps it works around.
                // A drop ONTO a module is a drop into what it carries: the module folder itself holds
                // its definition, and a sample landing beside module.yaml is neither a node nor a
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
                // below are file-only. The capture zone leans on that same early return: no
                // menu opens at all there.
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
                          // Through `assetsTarget`, exactly like the drop: a folder dragged onto
                          // a module becomes material under its `assets/`, and the picker is
                          // there because a drag that fails does so silently. The two must not
                          // disagree about where the same folder lands.
                          when: (t) => t.dir || t.root,
                          run: (t) => pickFolder(t.path),
                        },
                        {
                          key: "new-folder",
                          label: "Nouveau dossier…",
                          // On a module too, and it means `assets/` — a NAM pack is a folder per
                          // amp, so somewhere to drop into before the first file is a thing this
                          // menu has to be able to make. Never beside module.yaml: what a module
                          // IS is three files and its nodes, and the builder writes those.
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
                        // Two entries stood here: "Ajouter les N greffons du moteur", which
                        // turned a machine's whole plugin scan into library modules, and
                        // "Nouveau module depuis un greffon…" for one at a time. Both went
                        // with the `modules` family; the capability belongs in st0 and is not
                        // ported yet.
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
                          // A SONG is the row that is a folder on disk and a leaf in the tree, so
                          // asking `t.dir` alone would delete it with the single-file route and
                          // leave the folder behind.
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

            {/* A module view and a chain editor stood at the head of this chain of screens.
            Both went with their families: what a plugin's parameters are called is a fact about
            a LOADED plugin, and the médiathèque has no project to load one into. */}
            {editingSong ? (
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SongEditor
                  entry={editingSong}
                  vimMode={localStorage.getItem("pl8.vim") === "1"}
                  fileBase={choice.fileBase}
                  engineToken={choice.token}
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
                            : undefined
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

            {/* A third column stood here, for a picked MODULE: its name, a way into its text,
            and a line saying where modules are built. It went with the family. */}

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
