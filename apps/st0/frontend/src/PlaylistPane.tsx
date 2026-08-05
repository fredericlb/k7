// PlaylistPane.tsx — the right half of a playlist's screen: its lines resolved against the
// songs the library holds, each one playable, and the next one starting when one ends. The
// transport is the tab's own — this pane starts things and never holds them. Named for the
// pane and not for the lines, which are `playlistItems.ts`. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import type { PlaylistItem } from "@studio/mediatek/playlist";
import type { MediatekEntry } from "@studio/mediatek/types";
import {
  AudioLines,
  Disc3,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUser, library } from "./api";
import { cacheRoot, playablePath } from "./engine/chainPreview";
import { useEngine, usePlayback } from "./playback/PlaybackProvider";
import {
  effectiveTarget,
  type PlaybackTarget,
  playbackTargetInfo,
} from "./playback/targets";
import {
  itemLabel,
  itemProblem,
  type ResolvedItem,
  resolveItems,
} from "./playlistItems";
import { renderNames } from "./songTakes";

/** Said once at the top rather than on every row: it is a fact about the MACHINE, and a
 *  refusal repeated per line reads as ten problems instead of one. */
const NO_CACHE =
  "cette machine ne tient pas de cache de la médiathèque — jouez ici, ou choisissez-en une autre";

/** The key a probed render is remembered under. The song and the version, because a variant
 *  name is unique only inside one sidecar. */
const renderKey = (song: MediatekEntry, take: string): string =>
  `${song.path}::${take}`;

export function PlaylistPane({
  items,
  songs,
  target,
  engineToken,
}: {
  /** The lines, as the text on the left currently parses. */
  items: PlaylistItem[];
  /** The songs family, or null before its listing has arrived. */
  songs: MediatekEntry[] | null;
  /** Where the account wants sound to come out. See ../docs/playbackTarget.md. */
  target: PlaybackTarget;
  /** The chosen machine's engine token, for the file routes it gates. */
  engineToken?: string | null;
}) {
  const playback = usePlayback();
  const engine = useEngine();
  const actual = effectiveTarget(target, engine.phase.k === "ready");
  const viaEngine = actual === "engine";
  const where = playbackTargetInfo(actual);
  const WhereIcon = where.icon;

  const rows = useMemo(() => resolveItems(items, songs), [items, songs]);

  /**
   * The render a chain variant would be, once probed — or null for one nobody has rendered.
   *
   * A ref and not state, because it is read inside the async `startAt` below: state read there
   * would be whatever it was when that callback was made, and a probe that landed since would
   * be invisible to the very click that needs it. `probed` is what redraws.
   */
  const renders = useRef(new Map<string, string | null>());
  const [probed, setProbed] = useState(0);
  /** The same map, as something the RENDER may read: a ref mutated in place would not redraw
   *  the row whose probe just landed. `probed` is the bump that rebuilds this. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `probed` is the trigger — see above
  const renderOf = useMemo(() => new Map(renders.current), [probed]);

  /** The audio inside the song's folder, probing for a chain's render if that is what it is. */
  const audioFor = useCallback(
    async (r: ResolvedItem): Promise<string | null> => {
      if (!r.song || !r.take) return null;
      if (r.take.file) return r.take.file;
      if (r.take.kind !== "chain") return null;
      const key = renderKey(r.song, r.take.name);
      const known = renders.current.get(key);
      if (known !== undefined) return known;
      // Two names and not one: the bounce lands as mp3 or wav depending on whether that
      // machine had ffmpeg (see songTakes.ts's renderNames).
      let found: string | null = null;
      for (const name of renderNames(r.take.name))
        if (await library.exists(`${r.song.path}/${name}`)) {
          found = name;
          break;
        }
      renders.current.set(key, found);
      setProbed((n) => n + 1);
      return found;
    },
    [],
  );

  // Probe every chain row up front, so a row says "pas encore rendue" before it is clicked
  // rather than after. One request per version, and only for the versions that are chains.
  //
  // Keyed on the chain rows THEMSELVES as a string: `rows` is rebuilt whenever the text on the
  // left changes — every keystroke — and naming it here would re-probe the library on each one.
  const chainKey = rows
    .filter((r) => r.song && r.take?.kind === "chain")
    .map((r) => renderKey(r.song as MediatekEntry, r.take?.name ?? ""))
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: chainKey IS the dependency — see above
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const r of rows)
        if (alive && r.take?.kind === "chain") await audioFor(r);
    })();
    return () => {
      alive = false;
    };
  }, [chainKey, audioFor]);

  /**
   * The cache's absolute root on the engine's machine, when that is where this will play.
   *
   * Two disks: the médiathèque this browser talks to is hosted, the moteur opens paths on its
   * own. `undefined` is "not looked yet" and `null` is "that machine keeps no cache" — merged
   * into one nullable, every row would grey out for the moment the answer takes, which reads
   * as a fault rather than as a wait.
   */
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!viaEngine || !engine.fileBase) return setRoot(undefined);
    let alive = true;
    void cacheRoot(engine.fileBase, currentUser(), engineToken).then((r) => {
      if (alive) setRoot(r);
    });
    return () => {
      alive = false;
    };
    // The token arrives with the engine probe, so the first run can have none and would
    // otherwise settle on the 401's `null` and never look again.
  }, [viaEngine, engine.fileBase, engineToken]);

  /** Which line THIS pane started. Null when it started nothing, or when something else took
   *  the transport over — `mine` below is what checks the second. */
  const [current, setCurrent] = useState<number | null>(null);
  /** What the footer says about a click that did not start anything. Cleared by the next one. */
  const [notice, setNotice] = useState("");
  const at = current === null ? null : rows[current];
  const mine =
    !!at?.song &&
    !!playback.now &&
    playback.now.path.startsWith(`${at.song.path}/`);

  /**
   * Start the first line from `from` that has audio, or stop if none has.
   *
   * Skipping is deliberate and only ever over a RESOLUTION problem — a song the library has
   * not got, a variant nobody rendered. A playlist that halted on its third line because of a
   * typo would be a playlist you cannot listen to while you fix it. The row still says what is
   * wrong with it; it just does not stop the evening.
   */
  const startAt = useCallback(
    async (from: number) => {
      setNotice("");
      // Still asking that machine whether it keeps a cache at all. Said as a WAIT rather than
      // as one of the two refusals below, either of which would be a guess at this point —
      // and said at all, because a click that does nothing reads as a broken button.
      if (viaEngine && root === undefined)
        return setNotice("on demande à cette machine où est son cache…");
      for (let i = from; i < rows.length; i++) {
        const r = rows[i];
        if (!r.song) continue;
        const file = await audioFor(r);
        if (!file) continue;
        const enginePath =
          viaEngine && root ? playablePath(root, r.song, file) : null;
        // Nothing to open on that machine. Not skipped — that is a fault of the DESTINATION
        // and not of the line, and walking the whole playlist because one machine has no cache
        // would look like the playlist being broken.
        if (viaEngine && !enginePath) return setNotice(NO_CACHE);
        setCurrent(i);
        playback.start({
          entry: r.song,
          path: `${r.song.path}/${file}`,
          target: actual,
          enginePath,
        });
        return;
      }
      setCurrent(null);
    },
    [rows, audioFor, viaEngine, root, actual, playback.start],
  );

  /**
   * One line ends, the next begins.
   *
   * `playback.ended` is a counter, so this compares it with what was last seen rather than
   * reacting to a flag somebody has to clear. Only when the thing that ended is OURS: the bar
   * at the bottom outlives this screen, and a song started from a morceau's own page must not
   * make a playlist nobody is looking at walk forward.
   */
  const seenEnded = useRef(playback.ended);
  useEffect(() => {
    if (playback.ended === seenEnded.current) return;
    seenEnded.current = playback.ended;
    if (!mine || current === null) return;
    void startAt(current + 1);
  }, [playback.ended, mine, current, startAt]);

  const toggleRow = useCallback(
    (i: number) => {
      // The row that is already going: hand the transport its own verb rather than restarting
      // it, so pause/resume keeps the position.
      if (mine && current === i) return playback.toggle();
      void startAt(i);
    },
    [mine, current, playback.toggle, startAt],
  );

  const playable = rows.filter((r) => r.song && r.take).length;
  // Settled, and empty. `undefined` is still being asked and says nothing yet.
  const noCache = viaEngine && root === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!playable || noCache}
          onClick={() => void startAt(0)}
        >
          <Play className="mr-1 h-4 w-4" /> Tout jouer
        </Button>
        <span className="text-xs text-muted-foreground">
          {rows.length} ligne{rows.length > 1 ? "s" : ""}
          {playable === rows.length ? "" : ` · ${playable} jouable(s)`}
        </span>
        {/* Where the sound is, beside the button that starts it. The picker in the header
            changes it; this only ever reports — including the fallback, since sound coming
            out of the wrong machine unannounced is the confusing half of that feature. */}
        <span
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
          title={
            actual === target
              ? where.hint
              : `${playbackTargetInfo(target).label} ne répond pas — lecture ici`
          }
        >
          <WhereIcon className="h-3.5 w-3.5" />
          {where.label}
          {actual === target ? "" : " (repli)"}
        </span>
      </header>

      {noCache ? (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
          {NO_CACHE}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Cette playlist ne nomme aucun morceau. Ajoutez des lignes sous{" "}
            <span className="font-mono">items:</span>, à gauche.
          </p>
        ) : (
          <ol className="flex flex-col">
            {rows.map((r, i) => {
              const problem = itemProblem(r, songs !== null);
              // A chain that has been probed and has no render: audio that does not exist yet,
              // which is a different sentence from a variant that does not exist at all.
              const key =
                r.song && r.take ? renderKey(r.song, r.take.name) : "";
              const unrendered =
                !problem &&
                r.take?.kind === "chain" &&
                renderOf.get(key) === null;
              const waiting =
                !problem &&
                r.take?.kind === "chain" &&
                renderOf.get(key) === undefined;
              const playingHere = mine && current === i && playback.playing;
              const loadedHere = mine && current === i;
              return (
                <li
                  // The index IS the identity: a playlist may legitimately name the same song
                  // twice, and keying on the ref would make those one row.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={i}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    loadedHere ? "bg-accent/60" : "hover:bg-accent/30"
                  }`}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    disabled={!!problem || unrendered || waiting || noCache}
                    title={problem || (unrendered ? "pas encore rendue" : "")}
                    onClick={() => toggleRow(i)}
                  >
                    {playingHere ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : waiting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {/* A file variant and a chain variant are different things to go looking
                      for, so they wear the two glyphs SongVariants already draws. */}
                  {r.take?.kind === "chain" ? (
                    <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : r.take?.kind === "file" ? (
                    <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {itemLabel(r)}
                  </span>
                  {r.song?.meta?.artist ? (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {String(r.song.meta.artist)}
                    </span>
                  ) : null}
                  {/* What the line names, when it is not what the row is showing — so a ref
                      that resolved by NAME still says which path it landed on. */}
                  {problem ? (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                      {problem}
                    </span>
                  ) : unrendered ? (
                    <span
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      title="le bouton « Process » sous les variantes du morceau la rend"
                    >
                      pas encore rendue
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        <ListMusic className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">
          {playback.error ||
            notice ||
            (mine && at?.song
              ? `en cours : ${itemLabel(at)}`
              : "les lignes se jouent d'affilée ; la barre du bas suit ce qui sort")}
        </span>
      </footer>
    </section>
  );
}
