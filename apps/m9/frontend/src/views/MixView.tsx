// MixView.tsx — the desk: a deck top left, a deck top right, the set list between them, and
// the crossfader across the bottom. What plays comes from the project's `songs.yaml`; how loud
// each deck is comes from the crossfader. See ../../docs/mix.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
import type { MediatekEntry } from "@studio/mediatek/types";
import {
  MIX_VIEW_BASE,
  parseMixView,
  VIEWS_DIR,
} from "@studio/song/yaml/mixViewFile";
// Aliased: the component below is also called MixView, and a type shadowing it is exactly
// the confusion a reader does not need.
import type { MixView as MixViewFile } from "@studio/song/yaml/mixViewSchema";
import type { PublicEngine } from "@studio/web-protocol";
import {
  CloudDownload,
  Disc3,
  Headphones,
  Link2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  type DeckId,
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  MIX_CENTRE,
  NO_LOADS,
  pushCrossfade,
  sendDecks,
  syncedTempos,
} from "../deck";
import {
  enginePluginIds,
  hasPlugin,
  resolveBindings,
  stretchTargets,
  valueFor,
} from "../mixBindings";
import {
  cacheRelPath,
  type FileLink,
  fileLink,
  playablePath,
  service,
} from "../service";
import { EMPTY_SET, resolveSet, type SetEntry, type SetList } from "../setList";
import { type Playhead, useEngine } from "../useEngine";
import type { Envelope } from "../waveform";
import { BpmFader } from "./BpmFader";
import { SongBrowser } from "./SongBrowser";
import { Vinyl } from "./Vinyl";
import { Waveform } from "./Waveform";

/** The set list's file, project-relative. Named once — the name is @studio/song's. */
const SONGS_FILE = "songs.yaml";
/** …and the desk's bindings, from the same place, so the two names cannot drift. */
const MIX_VIEW_FILE = `${VIEWS_DIR}/${MIX_VIEW_BASE}.yaml`;

/**
 * A deck's waveform, and the two states that are not one.
 *
 * `none` CARRIES ITS REASON. It used to be a bare marker, and nothing drew it: a failed
 * envelope and a deck with no waveform looked identical — an empty strip, no explanation,
 * nothing to act on. The reason is the whole value of the state.
 */
type Wave =
  | { k: "loading" }
  | { k: "ready"; env: Envelope }
  | { k: "none"; why: string };

export function MixView({
  engine,
  project,
  graph,
}: {
  engine: RankedEngine<PublicEngine>;
  /** The project this app was opened on, workspace-relative — what the set list belongs to. */
  project: string;
  /** The compiled chains. Where a binding's module name becomes a plugin id. */
  graph: WebGraph | null;
}) {
  const deck = useEngine(engine);
  // Derived, never typed and never stored: the file service is on the chosen engine's host.
  // The identity rides in the shared headers — see service.ts. Both used to be text boxes.
  const link = useMemo(() => fileLink(engine), [engine]);
  const [root, setRoot] = useState<string | null>(null);
  const [set, setSet] = useState<SetList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState<DeckLoads>(NO_LOADS);
  const [mix, setMix] = useState(MIX_CENTRE);
  // Per deck. Three states rather than a nullable envelope: "still computing" and "there
  // will not be one" look identical as `null`, and they are different sentences on screen.
  const [waves, setWaves] = useState<Partial<Record<DeckId, Wave>>>({});
  // Where each fader is. Seeded from the envelope's estimate when it lands, then owned by
  // the hand — a later re-analysis must not yank a tempo somebody has set.
  const [faders, setFaders] = useState<DeckTempos>({});
  /** Which deck LEADS, or null. The two sync buttons are one choice, not two toggles. */
  const [master, setMaster] = useState<DeckId | null>(null);
  /** Which deck's song browser is open, if any — one dialog, told which deck it is for. */
  const [browsing, setBrowsing] = useState<DeckId | null>(null);
  /** The desk's bindings, as `views/mix.yaml` declares them. */
  const [view, setView] = useState<MixViewFile>({});
  /**
   * The COMPILED project — the chains, the crossfade's baked graph, the whole document the
   * engine is meant to play. Null until it arrives, or when the project will not compile, and
   * the deck falls back to the stand-in rather than going silent.
   */
  const [compiled, setCompiled] = useState<ProjectDoc | null>(null);

  // Checked against the project on every compile, so a binding that names a module the chains
  // do not have is a sentence on screen rather than a control that quietly does nothing.
  const wiring = useMemo(() => resolveBindings(view, graph), [view, graph]);

  // What the decks actually play at: the faders, with the master's value handed to the slave.
  // Derived rather than stored, so the two can never disagree — pressing sync and moving the
  // master's fader are the same code path, and the slave has nowhere to hold a stale number.
  const tempos = useMemo(() => syncedTempos(faders, master), [faders, master]);
  /**
   * The plugin ids the engine will HAVE — the compiled document's, never the graph's.
   *
   * `buildGraphDoc` hands every step a `pluginId` it *would* have, including steps the
   * compiler emits no plugin for: an `offline` tempo comes back as `deckA:tempoA` with no
   * such plugin anywhere. Deciding a control's path off that is what left the tempo faders
   * doing nothing — they were classed as params and sent into the void.
   */
  const plugins = useMemo(() => enginePluginIds(compiled), [compiled]);

  // Which TRACK each fader stretches, read off views/mix.yaml — see stretchTargets.
  const stretches = useMemo(
    () => stretchTargets(wiring.bindings, tempos, plugins),
    [wiring, tempos, plugins],
  );

  // A mirror, read by `commit`. `pointerup` can arrive before React has re-rendered from the
  // last `onChange`, and a `commit` closed over that render's value would send the document
  // one drag-step stale — silently, and only sometimes.
  const latest = useRef(stretches);
  latest.current = stretches;

  const refresh = useCallback(
    async (s: FileLink) => {
      try {
        const sum = await service.summary(s);
        setRoot(sum.root);
        const cached = (await service.songs(s)).entries;
        // TWO sources, and the project's is the one that decides what is drawn: songs.yaml
        // says which songs this set is, the cache listing says which of them this machine can
        // play. A song in the set and not in the cache is a line, not an omission.
        setSet(await readSet(project, cached));
        setView(await readMixView(project));
        // Allowed to fail on its own: a set whose project will not compile can still choose
        // songs and still play them through the stand-in, and losing the whole desk over it
        // would take away the screen you fix it from.
        setCompiled(await api.engineDoc().catch(() => null));
        setError(null);
      } catch (e) {
        setSet(null);
        setError((e as Error).message);
      }
    },
    [project],
  );

  useEffect(() => {
    // A chosen engine whose host answers on the engine port but not the file port: the
    // catalogue is unreachable, and saying so beats an empty list that looks like an empty
    // médiathèque.
    if (!link)
      return setError(
        "le service de fichiers de cette machine ne répond pas — la médiathèque est injoignable",
      );
    void refresh(link);
  }, [link, refresh]);

  /** Put a song on a deck. The document carries both decks, so this re-sends it — the engine
   *  diffs, and whatever the OTHER deck was playing carries on underneath. */
  const load = (deckId: DeckId, s: SetEntry) => {
    // `link` is implied by `root` — the root came from a summary through it — but it is
    // carried explicitly so the waveform fetch below has it without a second assumption.
    if (!deck.engine || !root || !link || !s.entry) return;
    const path = playablePath(root, s.entry);
    // Said out loud rather than swallowed: a catalogued folder with no audio is a real state
    // — a mirror that failed halfway — and a dead button explains nothing.
    if (!path)
      return setError(
        `${s.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    const next: DeckLoads = {
      ...loads,
      [deckId]: { path, title: s.name, artist: s.artist, id: s.id },
    };
    setLoads(next);
    sendDecks(deck.engine, next, mix, undefined, stretches, compiled);

    // The waveform, fetched beside the load and never blocking it: the song is already
    // playing while this is still computing, which is the right order for a deck.
    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    // A new record starts at ITS own tempo, whatever the outgoing one was doing. The fader
    // is cleared here rather than left showing the previous song's number.
    setFaders((f) => ({ ...f, [deckId]: undefined }));
    void service
      // The SAME master `playablePath` just resolved, cache-relative — the route wants a path
      // inside the cache, not one on the engine's disk.
      .envelope(link, cacheRelPath(s.entry) ?? "")
      .then((env) => {
        setWaves((w) => ({ ...w, [deckId]: { k: "ready", env } }));
        // The tempo arrives WITH the waveform — the sidecar carries both — so this is where
        // the fader gets its scale and its home notch.
        const t: DeckTempo = {
          natural: env.bpm,
          seconds: env.seconds,
          target: env.bpm,
        };
        setFaders((f) => ({ ...f, [deckId]: t }));
        // Re-sent so the OTHER deck's stretch survives this load: the document carries both
        // warps, and one built without this deck's tempo would drop the other's.
        if (deck.engine)
          sendDecks(
            deck.engine,
            next,
            mix,
            undefined,
            // The freshly measured tempo has not reached `stretches` yet — it is derived from
            // state this callback is still ahead of — so the same mapping is done inline.
            stretchTargets(
              wiring.bindings,
              syncedTempos({ ...faders, [deckId]: t }, master),
              plugins,
            ),
            compiled,
          );
      })
      // A waveform that will not come is not worth an error card over the whole desk — the
      // song plays regardless. But the REASON goes into the strip: the analysis needs the
      // engine on that machine, and "no engine binary" is a thing somebody can act on where
      // an empty rectangle is not.
      .catch((e: Error) =>
        setWaves((w) => ({ ...w, [deckId]: { k: "none", why: e.message } })),
      );
  };

  /**
   * Move a fader. The number follows the finger; the stretch waits for `commit`.
   *
   * **A hand on the SLAVE's fader cancels sync.** That is what the gesture means on every
   * deck that has the button: you are taking this tempo back. Without it the slave's knob
   * would fight the master and lose on the next render, which reads as a broken control.
   *
   * The value it lands on needs no special care: the knob was showing the SYNCED number, so
   * dragging it starts from there and continues — no jump back to whatever this deck was at
   * before the sync, which is the surprise a naive `setMaster(null)` first would cause.
   */
  const nudge = (deckId: DeckId, bpm: number) => {
    if (master && master !== deckId) setMaster(null);
    setFaders((f) => {
      const t = f[deckId];
      return t ? { ...f, [deckId]: { ...t, target: bpm } } : f;
    });
  };

  /**
   * Let go of a fader, or press sync: re-send the document.
   *
   * A warp is part of the DOCUMENT, not a plugin parameter, so there is no live message for
   * it — unlike the crossfader, which is why that one moves per pixel and this one lands on
   * release. Re-warping per pixel would have the stretch engine rebuilt for every step of a
   * drag, on both decks when they are synced.
   */
  const commit = (next = latest.current) => {
    if (deck.engine)
      sendDecks(deck.engine, loads, mix, undefined, next, compiled);
  };

  /** Press a sync button. Pressing the one already lit releases it — a set spends most of
   *  its time with neither deck leading, and there has to be a way back to that. */
  const toggleSync = (deckId: DeckId) => {
    const next = master === deckId ? null : deckId;
    setMaster(next);
    commit(syncedTempos(faders, next));
  };

  /** Drag the crossfader. One message per move, not a document — see pushCrossfade. */
  const crossfade = (value: number) => {
    setMix(value);
    if (!deck.engine) return;
    // THE DECLARED PATH: `views/mix.yaml` says this fader is the crossfade module's `Mix`, and
    // the compiled document is what put that module in the engine. One `set-plugin-param` and
    // the project's own DSP does the fade.
    // Only when the plugin is really IN the document the engine was sent — the graph hands
    // out an id for modules that compile to no plugin at all.
    const bound = wiring.bindings.find(
      (b) => b.control.id === "crossfade" && hasPlugin(b, plugins),
    );
    if (bound?.pluginId)
      return deck.engine.setPluginParam(
        bound.pluginId,
        bound.param,
        valueFor(bound, value),
      );
    // …and the stand-in, for the seconds before the compile lands or a project that will not
    // compile: no crossfade module in the engine, so the two decks' levels are moved instead.
    // Same law, different mechanism — see docs/mix.md.
    if (!compiled) return pushCrossfade(deck.engine, value);
    // Compiled, but nothing bound to a plugin the engine has. The levels the stand-in moves
    // are not in THIS document, so moving them would do nothing at all — and a crossfader
    // that silently does nothing is the exact bug this whole file keeps paying for.
    setError(
      `le crossfade n'est lié à aucun plugin chargé — vérifiez ${MIX_VIEW_FILE}`,
    );
  };

  const anyLoaded = !!(loads.deckA || loads.deckB);
  const ready = deck.phase.k === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* --- the two decks, and the set list between them ------------------------------ */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <DeckSide
          side="A"
          load={loads.deckA}
          spinning={deck.playing}
          wave={waves.deckA}
          playhead={deck.playhead}
          playing={deck.playing}
          tempo={tempos.deckA}
          driven={master === "deckB"}
          onNudge={(bpm) => nudge("deckA", bpm)}
          onCommit={commit}
          onPick={() => setBrowsing("deckA")}
        />

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {error ? (
            <Card className="p-3 text-sm text-destructive">{error}</Card>
          ) : null}
          {/* A set list that will not parse is the project's problem, not the machine's, so
              it is reported apart from the error above and names its own lines. */}
          {set?.issues.length ? (
            <Card className="p-3 text-sm text-destructive">
              <div className="font-semibold">{SONGS_FILE}</div>
              {set.issues.map((i) => (
                <div key={i} className="font-mono text-xs">
                  {i}
                </div>
              ))}
            </Card>
          ) : null}
          {/* A binding that names something this project has not got. Reported by CONTROL,
              because that is what looks broken from the desk: you move a fader, nothing
              happens, and this says which line to fix. */}
          {wiring.problems.length ? (
            <Card className="p-3 text-sm text-destructive">
              <div className="font-semibold">{MIX_VIEW_FILE}</div>
              {wiring.problems.map((p) => (
                <div key={p.control} className="font-mono text-xs">
                  {p.control} : {p.message}
                </div>
              ))}
            </Card>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            <SetListPane set={set} ready={ready} loads={loads} onLoad={load} />
          </div>
        </section>

        <DeckSide
          side="B"
          load={loads.deckB}
          spinning={deck.playing}
          wave={waves.deckB}
          playhead={deck.playhead}
          playing={deck.playing}
          tempo={tempos.deckB}
          driven={master === "deckA"}
          onNudge={(bpm) => nudge("deckB", bpm)}
          onCommit={commit}
          onPick={() => setBrowsing("deckB")}
        />
      </div>

      {/* One browser, told which deck it is for — two dialogs would be two pieces of state
          able to disagree about which is open. */}
      <SongBrowser
        side={browsing === "deckB" ? "B" : "A"}
        songs={set?.entries ?? []}
        open={browsing !== null}
        onOpenChange={(o) => setBrowsing(o ? browsing : null)}
        onPick={(song) => browsing && load(browsing, song)}
      />

      {/* --- the crossfader, across the bottom ----------------------------------------- */}
      <footer className="flex h-[10%] min-h-[4.5rem] shrink-0 items-center gap-6 border-t px-6">
        {/* At the two ENDS, flanking the crossfader, each under its own deck. The button says
            who LEADS: pressing the left one puts both records on deck A's tempo. */}
        <SyncButton
          side="A"
          on={master === "deckA"}
          enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
          onClick={() => toggleSync("deckA")}
        />

        {/* Off by default: the sound already comes out of the machine's interface, so this
            doubles it. On a laptop with no monitors it is the only way to hear anything. */}
        <label
          className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
          title="Le son sort déjà de l'interface de cette machine. Cochez pour l'entendre aussi dans cet onglet."
        >
          <input
            type="checkbox"
            checked={deck.listening}
            onChange={(e) => deck.setListening(e.target.checked)}
          />
          <Headphones className="h-4 w-4" />
          Écouter ici
        </label>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="w-4 shrink-0 text-center text-sm font-semibold">
            A
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix}
            onChange={(e) => crossfade(Number(e.target.value))}
            disabled={!ready}
            className="min-w-0 flex-1 accent-foreground"
            aria-label="crossfade entre la platine A et la platine B"
          />
          <span className="w-4 shrink-0 text-center text-sm font-semibold">
            B
          </span>
          {/* Double-click the readout to recentre — the one crossfader position worth a
              shortcut, and the one a mouse drag never lands on exactly. */}
          <button
            type="button"
            onDoubleClick={() => crossfade(MIX_CENTRE)}
            title="double-clic : recentrer"
            className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {Math.round(mix * 100)}%
          </button>
        </div>

        <Button
          size="sm"
          variant={deck.playing ? "default" : "secondary"}
          disabled={!ready || !anyLoaded}
          // ONE transport for both decks: the engine has a single one, so this runs the whole
          // document and the crossfader is what chooses between them. See docs/mix.md.
          title={
            !ready
              ? "aucun moteur sur cette machine"
              : !anyLoaded
                ? "aucune platine chargée"
                : deck.playing
                  ? "arrêter"
                  : "lancer les deux platines"
          }
          onClick={() => deck.engine?.transport(deck.playing ? "stop" : "play")}
        >
          {deck.playing ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-xs"
          title="Relire le cache de la médiathèque"
          onClick={() => link && void refresh(link)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>

        <SyncButton
          side="B"
          on={master === "deckB"}
          enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
          onClick={() => toggleSync("deckB")}
        />
      </footer>
    </div>
  );
}

/**
 * One end of the sync pair: "this deck leads".
 *
 * Two buttons, ONE choice — pressing the lit one releases it, because a set spends most of
 * its time with neither deck leading and there has to be a way back to that. Both dark is a
 * state, not an absence of one.
 *
 * Disabled until BOTH decks have a tempo: there is nothing to sync to otherwise, and a
 * button that does nothing when pressed is worse than one that says why it cannot.
 */
function SyncButton({
  side,
  on,
  enabled,
  onClick,
}: {
  side: "A" | "B";
  on: boolean;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "secondary"}
      disabled={!enabled}
      className="shrink-0"
      title={
        !enabled
          ? "il faut un tempo sur les deux platines"
          : on
            ? `la platine ${side} mène — cliquer pour relâcher`
            : `synchroniser sur la platine ${side}`
      }
      onClick={onClick}
    >
      <Link2 className="mr-1 h-3.5 w-3.5" />
      SYNC {side}
    </Button>
  );
}

/** One deck: its tempo fader, the record, its waveform, and what it is holding. */
function DeckSide({
  side,
  load,
  spinning,
  wave,
  playhead,
  playing,
  tempo,
  driven,
  onNudge,
  onCommit,
  onPick,
}: {
  side: "A" | "B";
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  playhead: React.RefObject<Playhead>;
  playing: boolean;
  /** What this deck plays at — already synced, so a slave shows the master's number. */
  tempo: DeckTempo | undefined;
  /** Driven by the other deck: the fader moves on its own and greys out. */
  driven: boolean;
  onNudge: (bpm: number) => void;
  onCommit: () => void;
  /** The record's middle was clicked — open the browser for this deck. */
  onPick: () => void;
}) {
  const fader = (
    <BpmFader
      natural={tempo?.natural ?? 0}
      target={tempo?.target ?? 0}
      driven={driven}
      onChange={onNudge}
      onCommit={onCommit}
    />
  );

  return (
    <section className="flex w-[30%] min-w-[17rem] shrink-0 gap-2">
      {/* On the OUTER edge of each deck, so the two records stay turned towards the set
          between them and the desk reads as a mirror rather than a repeat. */}
      {side === "A" ? fader : null}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        <Vinyl
          side={side}
          artist={load?.artist ?? null}
          title={load?.title ?? null}
          spinning={spinning && !!load}
          onPick={onPick}
        />
        {/* Under the record, as a deck has it. Only once something is loaded: an empty strip
            under an empty deck is furniture. */}
        {load ? (
          <Waveform
            envelope={wave?.k === "ready" ? wave.env : null}
            playhead={playhead}
            playing={playing}
            analysing={wave?.k === "loading"}
            problem={wave?.k === "none" ? wave.why : null}
          />
        ) : null}
        <div className="w-full truncate text-center text-xs text-muted-foreground">
          {load ? load.title : "rien de chargé"}
        </div>
      </div>
      {side === "B" ? fader : null}
    </section>
  );
}

/** The project's songs, with a button per deck on each row. */
function SetListPane({
  set,
  ready,
  loads,
  onLoad,
}: {
  set: SetList | null;
  ready: boolean;
  loads: DeckLoads;
  onLoad: (deck: DeckId, s: SetEntry) => void;
}) {
  if (set === null)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Pas de service local joignable. m9 lit le CACHE de la médiathèque, pas
        la bibliothèque hébergée — c'est le moteur qui joue, et il ouvre des
        fichiers.
      </Card>
    );
  // No songs.yaml at all — an l8 song opened here, or a set from before the file existed.
  // Named as the missing file it is, since adding it is one edit away in the Édition view.
  if (set.absent)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Ce projet n'a pas de <code>{SONGS_FILE}</code>. C'est le fichier qui dit
        quels morceaux de la médiathèque font partie du set.
      </Card>
    );
  if (!set.entries.length)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Le set est vide. Ajoutez des morceaux dans <code>{SONGS_FILE}</code> —
        ils seront tirés dans le cache de cette machine tout seuls.
      </Card>
    );

  return (
    <ul className="flex flex-col gap-1">
      {set.entries.map((s) => (
        <SetRow
          key={s.ref}
          song={s}
          ready={ready}
          on={
            loads.deckA?.id === s.id
              ? "A"
              : loads.deckB?.id === s.id
                ? "B"
                : null
          }
          onLoad={onLoad}
        />
      ))}
    </ul>
  );
}

/** One song of the set: what it is called, whether this machine can play it, and the two
 *  buttons that put it on a deck. */
function SetRow({
  song,
  ready,
  on,
  onLoad,
}: {
  song: SetEntry;
  ready: boolean;
  /** The deck this song is currently on, or null. */
  on: string | null;
  onLoad: (deck: DeckId, s: SetEntry) => void;
}) {
  const master = song.entry?.meta?.master;
  const playable = !!song.entry && !!master && ready;
  // Three states, and they are three different sentences. Not in the cache is the ordinary
  // one — the sync pulls what the open set names, so a song added a minute ago is on its way.
  const why = !song.entry
    ? "pas encore dans le cache de cette machine — la synchro va le chercher"
    : !master
      ? "ce dossier ne porte aucun audio"
      : !ready
        ? "aucun moteur sur cette machine"
        : null;

  return (
    <li
      className={`flex items-center gap-3 rounded-md px-3 py-2 ${
        on ? "bg-accent/60" : "hover:bg-accent/30"
      }`}
    >
      {song.entry ? (
        <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <CloudDownload className="h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-sm ${song.entry ? "" : "text-muted-foreground"}`}
        >
          {song.name}
        </span>
        {song.artist ? (
          <span className="truncate text-xs text-muted-foreground">
            {song.artist}
          </span>
        ) : null}
      </span>
      {(["A", "B"] as const).map((s) => (
        <Button
          key={s}
          size="sm"
          variant={on === s ? "default" : "secondary"}
          disabled={!playable}
          // Disabled with a reason, not just greyed.
          title={why ?? `charger sur la platine ${s}`}
          onClick={() => onLoad(s === "A" ? "deckA" : "deckB", song)}
        >
          {s}
        </Button>
      ))}
    </li>
  );
}

/**
 * Read the project's set list and resolve it against what the cache holds.
 *
 * A project with no `songs.yaml` reads as ABSENT rather than as an error: an l8 song can be
 * opened here, and a set written before the file existed still opens. The route answers 404
 * for both a missing file and an unreadable one, which is why this cannot tell them apart —
 * and does not need to, since neither is something m9 can fix.
 */
/**
 * Read the desk's bindings. Absent is the ordinary state — a set that has bound nothing, or a
 * project written before the file existed — so it reads as "no bindings" and not as an error.
 * A file that is THERE and malformed is a different matter, and `parseMixView` reports it.
 */
async function readMixView(project: string): Promise<MixViewFile> {
  const path = project === "." ? MIX_VIEW_FILE : `${project}/${MIX_VIEW_FILE}`;
  try {
    return parseMixView((await api.read(path)).content).value ?? {};
  } catch {
    return {};
  }
}

async function readSet(
  project: string,
  cached: MediatekEntry[],
): Promise<SetList> {
  const path = project === "." ? SONGS_FILE : `${project}/${SONGS_FILE}`;
  try {
    return resolveSet((await api.read(path)).content, cached);
  } catch {
    return EMPTY_SET;
  }
}
