// Library.tsx — the catalogue: four sections as header tabs (three families and the raw
// capture zone), the current one's files as a tree down the side, its contents in the
// middle. Refetches a section only when ITS token moved, which is the whole reason the
// service hands out one per section. The chrome follows pistes — same shell, same tree.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import type { RecordingDay } from "@studio/mediatek/recordings";
import { type MediatekEntry, RECORDINGS_DIR } from "@studio/mediatek/types";
import { engineFaceModule, FACE_CATEGORIES } from "@studio/song/engineFace";
import type { BuilderPane } from "@studio/ui-module-builder";
import {
  Boxes,
  Disc3,
  Loader2,
  LogOut,
  type LucideIcon,
  Mic,
  Pencil,
  Settings,
  Waves,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddMorceau } from "./AddMorceau";
import { AddRecording } from "./AddRecording";
import { auth, engineMachine, library } from "./api";
import { ChainEditor } from "./ChainEditor";
import { EngineList, EnginePicker } from "./engine/EnginePicker";
import { ModuleParams } from "./engine/ModuleParams";
import { useEngineChoice } from "./engine/useEngineChoice";
import { ModuleEditor } from "./ModuleEditor";
import { DEFAULT_SECTION, fileOf, moduleOf, type SectionId } from "./routes";
import { useLibraryRoute } from "./useLibraryRoute";

/**
 * The header's tabs: the three families, plus the raw capture zone.
 *
 * RECORDINGS is a section and NOT a family — it is a folder at the mediatek root, it holds
 * no catalogue entries, and it has no listing to ask `/list` for. It sits here because the
 * screen is organised by what you are looking at, and what you are looking at is a fourth
 * thing. See packages/mediatek/docs/recordings.md.
 */
const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "morceaux", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "chains", label: "Chaînes", icon: Workflow },
  { id: RECORDINGS_DIR, label: "Recordings", icon: Mic },
];

/** The three that ARE families — the only ids `/list` and `/manifest` accept. */
type FamilyId = Exclude<SectionId, typeof RECORDINGS_DIR>;

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

/** The file that IS a chain, the same way `module.yaml` is a module. */
const CHAINS_FILE = "chains.yaml";
const holdsChainsFile = (e: MediatekEntry): boolean =>
  e.family === "chains" && !!e.files?.includes(CHAINS_FILE);

/** A folder the tree draws as ONE row, whatever it holds: a module or a chain. Both are folders
 *  on disk whose contents are a definition, not somewhere to browse. */
const foldsToOneRow = (e: MediatekEntry): boolean =>
  holdsModuleFile(e) || holdsChainsFile(e);

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
 * A MODULE is the one entry that is a folder rather than a file, and its children are the files it
 * ACTUALLY holds — nothing more. Rows were once drawn for the panel and the shelf before either
 * existed, on the argument that a file nobody can click on is a file nobody writes; but a row for a
 * file that is not there lies about the disk, and the BUILDER is where those two get created anyway.
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
        // A MODULE is a LEAF, folder though it is on disk. Its three files are its definition,
        // not contents to browse: you edit a module, and the builder is what edits all three.
        // Leaving it foldable offered a row per file that opened the same screen three ways.
        //
        // Everything else keeps the shape it had. In `modules/` that matters: an entry with no
        // module file is a CATEGORY — or a folder you just made — and folding it would leave
        // you unable to open it, let alone put a module in it.
        const folds =
          leaf &&
          (!["modules", "chains"].includes(e.family) || foldsToOneRow(e));
        node = folds
          ? { name: part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
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
  // Whether the TREE may write. Two sections say no, for two different reasons: `morceaux/`
  // has a shape deduced from tags — a folder made by hand there is not a badly filed
  // morceau, it is an invisible one — and a capture is named by the clock, so a renamed one
  // would be a capture at an hour it was not made. Both have a header button instead; see
  // packages/mediatek/docs/upload.md and docs/recordings.md.
  const editable = section !== "morceaux" && !isZone;
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
        children: isZone ? dayNodes(recordings) : treeOf(entries, unlisted),
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
    const dir = moduleOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    if (!entry || !holdsModuleFile(entry)) return null;
    return { entry, pane: PANE_OF[fileOf(file) ?? ""] ?? "module" };
  }, [entries, file]);
  // The same derivation for a CHAIN. Its own memo rather than a branch inside the one above:
  // the two editors take different props, and a union that carried both would be read apart
  // again at every use.
  const editingChain = useMemo(() => {
    const dir = moduleOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && holdsChainsFile(entry) ? entry : null;
  }, [entries, file]);
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
   */
  const [revealed, setRevealed] = useState<string | null>(null);
  const target = editing
    ? relative(editing.entry.path)
    : picked
      ? relative(picked.path)
      : null;
  useEffect(() => {
    if (target) setRevealed(target);
  }, [target]);
  // No socket of its own — it only lists and remembers. useModuleEngine holds the
  // connection, and two hooks opening one would be two connections from one tab.
  const choice = useEngineChoice();
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

  // One poll drives every section: fetch the token map, and reload the SELECTED one only if
  // its token moved. A section nobody is looking at just updates its count on switch. The
  // zone is in that map beside the families, so there is still exactly one poll.
  useEffect(() => {
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
  }, [isZone, load, loadZone, section]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* The families moved from the side to the header, where pistes puts its views: the
          side is worth more as the current zone's tree than as three fixed buttons. */}
      <header className="flex items-center gap-4 border-b px-6 py-2">
        <span className="text-lg font-semibold tracking-tight">mediatek</span>
        <nav className="flex items-center gap-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSection(id);
                setEntries(null);
                setPicked(null);
              }}
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
        {/* Chaque section que l'arbre ne sait pas écrire a son bouton ici : morceaux parce
            que son arborescence est déduite des tags, recordings parce qu'une capture est
            nommée par l'horloge. Voir docs/upload.md et docs/recordings.md. */}
        <div className="ml-auto flex items-center gap-3">
          {section === "morceaux" ? <AddMorceau onDone={refresh} /> : null}
          {isZone ? <AddRecording onDone={refresh} onError={setError} /> : null}
          <span className="text-xs tabular-nums text-muted-foreground">
            {VERSION}
          </span>
        </div>
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
            <DropdownMenuItem onSelect={() => void auth.logout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

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
                  Les modules se construisent contre un greffon chargé : c'est
                  lui qui donne les noms des paramètres, leurs bornes et ses
                  presets d'usine. Sans moteur, l'éditeur ne peut que deviner.
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
        {/* The zone being explored, as a tree: /morceaux, /samples or /modules. Same
            component pistes uses for a workspace, fed from the entry paths. */}
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
              const files = Array.from(e.target.files ?? []).map((file) => ({
                path: file.webkitRelativePath || file.name,
                file,
              }));
              const dir = pickInto.current;
              e.target.value = "";
              if (files.length)
                void library
                  .uploadTree(dir ? `${section}/${dir}` : section, files)
                  .then(refresh)
                  .catch((err: Error) => setError(err.message));
            }}
          />
          <FileTree
            nodes={tree}
            // The family IS the root: rootPath is what a drop onto empty space and the
            // background menu target, and every node path below is relative to it.
            rootPath=""
            rootLabel={section.toUpperCase()}
            // The module being edited outranks the merely selected one: it is what the middle
            // of the screen is showing, and the tree is now beside it rather than replaced.
            activePath={
              editing
                ? relative(editing.entry.path)
                : picked
                  ? relative(picked.path)
                  : null
            }
            // Open down to it, so a reloaded deep link lands on a tree showing where it is
            // rather than one collapsed to the root. Sticky — see `revealed`.
            reveal={revealed}
            // A MODULE is a row you edit: clicking it opens the builder, on the PANEL, which is
            // what people come to this screen for and what the "Éditer" button already chose.
            // Anything else just selects.
            onOpen={(n) => {
              const entry = entryAt(entries, n.path);
              if (!entry) return;
              if (holdsModuleFile(entry)) openFile(`${n.path}/${UI_FILE}`);
              // A chain has one file, so the address names it rather than a pane.
              else if (holdsChainsFile(entry))
                openFile(`${n.path}/${CHAINS_FILE}`);
              else setPicked(entry);
            }}
            // A module and a chain each wear the glyph of their own tab. Without one the row
            // would read as a plain file, which is the one thing neither is.
            icon={(n) => {
              const e = entryAt(entries, n.path);
              if (e && holdsModuleFile(e))
                return <Boxes className="h-4 w-4 shrink-0" />;
              if (e && holdsChainsFile(e))
                return <Workflow className="h-4 w-4 shrink-0" />;
              return null;
            }}
            // Absent for morceaux, which is why the header has a button instead: a file
            // dropped here would land where it fell, and that family's shape is deduced
            // from tags rather than chosen. Undefined and not a no-op — the shared tree
            // reads these props to decide whether a row is even a drop target.
            // onDropTree and not onDropFiles: a module IS a folder, so dropping one has to
            // arrive as a folder. `dataTransfer.files` cannot carry that — see the shared
            // tree's lib/droppedEntries.ts for why, and for the two traps it works around.
            onDropTree={
              editable
                ? (dir, files) =>
                    void library
                      .uploadTree(dir ? `${section}/${dir}` : section, files)
                      .then(refresh)
                      .catch((e: Error) => setError(e.message))
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
                        `${section}/${toDir ? `${toDir}/` : ""}${from.split("/").pop()}`,
                      )
                      .then(refresh)
                      .catch((e: Error) => setError(e.message))
                : undefined
            }
            cancelLabel="Annuler"
            // Every target needs at least one action that passes its `when`, or the menu
            // does not open AT ALL — the shared tree returns early rather than showing an
            // empty one. Folders and the root would otherwise have none, since the two
            // below are file-only. Empty for morceaux, which uses that same early return:
            // no menu opens at all on that family.
            actions={
              !editable
                ? []
                : [
                    {
                      key: "upload-folder",
                      label: "Téléverser un dossier…",
                      when: (t) =>
                        (t.dir || t.root) && !isModuleFolder(entries, t.path),
                      run: (t) => pickFolder(t.path),
                    },
                    {
                      key: "new-folder",
                      label: "Nouveau dossier…",
                      // Anywhere but INSIDE a module: a module holds its own files and its
                      // instances, never folders. Depth is not this menu's business — the
                      // scanner finds a module wherever its file is.
                      when: (t) =>
                        (t.dir || t.root) && !isModuleFolder(entries, t.path),
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
                          if (!q) return `${plugins.length} greffons scannés`;
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
                          (p) => p.toLowerCase() === value.trim().toLowerCase(),
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
                      // `t.dir` alone is no longer the question: a module is a folder on disk
                      // that the tree draws as a leaf, so asking the ROW would delete it with
                      // the single-file route and leave the folder behind.
                      run: (t) =>
                        void (
                          t.dir || isModuleFolder(entries, t.path)
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
              engineId={choice.chosenId}
              onBack={() => openFile(null)}
            />
          </main>
        ) : editingChain ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChainEditor
              entry={editingChain}
              vimMode={localStorage.getItem("mediatek.vim") === "1"}
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
                  Aucun enregistrement pour l'instant. Les machines poussent ici
                  par l'API ; le bouton envoie un lot à la main.
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
                    onClick={() =>
                      setPicked((p) => (p?.id === e.id ? null : e))
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
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
                onClick={() => openFile(`${relative(picked.path)}/${UI_FILE}`)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Éditer
              </Button>
            </div>
            <ModuleParams entry={picked} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
