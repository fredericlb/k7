// useDeckSet.ts — the two decks as a DOCUMENT: what is on them, what they play at, and every
// gesture that changes either. Held by Studio, not by a view, so it outlives the tab you are
// looking at. See docs/deckSet.md.

import { usePluginParams } from "@studio/engine-browser/params";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
import { projectApi as api } from "@studio/project-shell/project";
import { STEMS, type Stem, stemControl } from "@studio/song-schema/stems";
import {
  cueMarkers,
  parseMix,
  withMarkers,
} from "@studio/song-schema/yaml/mixFile";
import type { MixView as MixViewFile } from "@studio/song-schema/yaml/mixViewSchema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DECKS,
  type DeckId,
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  EQ_BANDS,
  MIX_CENTRE,
  metronomeDeck,
  NO_LOADS,
  nudgedTempos,
  playFrom,
  pushCrossfade,
  sendDecks,
  sourceAt,
  syncedTempos,
  TEMPO_SOURCE_PARAM,
  transportAt,
} from "./deck";
import type { Deck } from "./engine";
import {
  type BindingProblem,
  controlDriving,
  engineAgrees,
  enginePluginIds,
  hasPlugin,
  offlinePublish,
  resolveBindings,
  shownValue,
  stretchTargets,
  valueFor,
} from "./mixBindings";
import {
  MIX_FILE,
  MIX_VIEW_FILE,
  readMixText,
  readMixView,
  readPlaylistText,
  writeMixText,
} from "./mixView";

/**
 * How often a tempo may reach the engine WHILE a control is moving.
 *
 * The crossfader and the EQ are plugin params and go out per pixel; a tempo is a clip warp,
 * and the engine answers a changed warp by RE-INSERTING the clip. So this is the rate that
 * trade settles on: fast enough that the pitch tracks the hand rather than arriving at the
 * end, slow enough that each rebuild finishes before the next is asked for — on both decks at
 * once when they are synced.
 */
const LIVE_WARP_MS = 120;

/**
 * How far a deck's tempo must have moved since the last one for the drag to send another.
 *
 * A warp change is a clip rebuild, and a rebuild costs a stretcher restart — measured at about
 * 20 ms of smear even when the tempo barely moves. So a step too small to HEAR is pure cost:
 * 0.05 BPM at 120 is four hundredths of a percent, under a cent of pitch, and nobody has ever
 * heard one. What this buys is the end of a careful drag, where the hand moves in tenths and
 * would otherwise ask for eight rebuilds a second to say nothing.
 *
 * The release is exempt — see `release` — so the value let go of always lands whole.
 */
const LIVE_WARP_BPM = 0.05;

/**
 * How long after the last tempo a gesture from the GRAPH is considered over.
 *
 * The desk knows: a fader sends `pointerup`. The graph's knob does not report a release to its
 * host, so the trailing commit is timed instead — long enough not to fire mid-drag, short
 * enough that the exact value it was let go on lands promptly.
 */
const GRAPH_SETTLE_MS = 250;

/** Has any deck's tempo moved far enough since the last send to be worth a clip rebuild? */
function worthARebuild(sent: DeckTempos, now: DeckTempos): boolean {
  return DECKS.some((d) => {
    const a = sent[d];
    const b = now[d];
    if (!a || !b) return a !== b; // a deck appearing or leaving is not a fader movement
    return (
      Math.abs(a.target - b.target) >= LIVE_WARP_BPM ||
      a.natural !== b.natural ||
      a.align !== b.align
    );
  });
}

export interface DeckSet {
  loads: DeckLoads;
  /** What the decks play at — already synced, so a slave shows the master's number. */
  tempos: DeckTempos;
  master: DeckId | null;
  /** Where the crossfader is: the hand, else the engine, else the centre. */
  mix: number;
  /** Bindings that could not be resolved — a typo about this project's own modules. */
  problems: BindingProblem[];
  /** A sentence about the desk itself, distinct from the set list's own troubles. */
  deskError: string | null;

  /** One deck's EQ knobs in dB, by band id. Absent is flat. */
  eqOf: (deck: DeckId) => Partial<Record<string, number>>;
  /** Does this deck have an EQ the engine has actually loaded? */
  eqLive: (deck: DeckId) => boolean;
  /** Where this deck's filter sits, −100..+100. Undefined until anything says. */
  filterOf: (deck: DeckId) => number | undefined;
  filterLive: (deck: DeckId) => boolean;
  /** How much of each stem this deck is REMOVING, 0..1 by stem. Absent is none of it. */
  stemsOf: (deck: DeckId) => Partial<Record<Stem, number>>;
  /**
   * Does this deck have stem cuts the engine has actually loaded?
   *
   * False on a set that predates the feature — its mapping wires none, so the column is not
   * drawn at all rather than drawn dead. Whether the SONG has been separated is a different
   * question and a different grey: see `stemsReady`.
   */
  stemLive: (deck: DeckId) => boolean;
  /** …and whether the record on it has stems to subtract. Wired but not prepared is the
   *  ordinary state of a deck the night before a set. */
  stemsReady: (deck: DeckId) => boolean;
  /**
   * The separation of what is on this deck has landed — fill its four stem lanes.
   *
   * A re-send of the document with `stems: true`, and nothing else: the song, the tempo and the
   * transport are exactly where they were, so a deck that is playing goes on playing. What
   * changes is that `withDecks` now finds four more clips to put on it.
   *
   * It is a deck-level verb rather than a second `putOn` because that is what it is about — the
   * record has not changed, only what this machine knows about it.
   *
   * `id` is the song it was started for, and it is checked here rather than trusted: a separation
   * runs for minutes, and the deck may be holding something else by the time it lands.
   */
  stemsArrived: (deck: DeckId, id: string) => void;
  /** Can sync do its second half — put the two decks' beats together? */
  canAlign: boolean;

  /**
   * Which deck's beat a click WOULD follow, or null when the desk cannot offer one.
   *
   * Both the button's enabled state and the answer to "on which beat" — one value rather than
   * two, so the desk cannot draw an available metronome that nothing would click for. See
   * `metronomeDeck` for the rule.
   */
  clickDeck: DeckId | null;
  /** Is it on? False whenever `clickDeck` is null, whatever was asked for before. */
  clicking: boolean;
  toggleMetronome: () => void;

  /** mix.yaml as it stands on disk — the CUE sheet, and what a cue is written back into. */
  mixText: string;
  /**
   * The playlist the surface names, as text — the set list the browser draws.
   *
   * Three states in two fields, because the fixes differ: `undefined` is "this desk names no
   * playlist" (write a `playlist:` line), `null` is "the one it names is not on disk" (make it,
   * or fix the name), and a string is the file. See docs/setList.md.
   */
  playlistText: string | null | undefined;
  /** This deck's eight cue slots, positional. `null` is an empty button. */
  cuesOf: (deck: DeckId) => (number | null)[];
  /**
   * Drop a cue where the press BEGAN, and write it to songs.yaml.
   *
   * `transportSeconds` is the timeline position captured on the way down; what is stored is
   * the position in the FILE, because that is what survives a tempo change.
   */
  setCue: (deck: DeckId, slot: number, transportSeconds: number) => void;
  /** Send the transport to one. Nothing happens on an empty slot. */
  jumpCue: (deck: DeckId, slot: number) => void;

  /**
   * Start both decks, or stop them — the desk's Play button.
   *
   * Here rather than on the button because it is a transport RULE and not a click handler: play
   * starts where the music is (`playFrom`), and a bare `transport("play")` from a shell that
   * did not know about `TIMELINE_BASE` is exactly how Play came to do nothing at all.
   */
  toggleTransport: () => void;

  /** Put a song on a deck and send it. */
  putOn: (deck: DeckId, load: NonNullable<DeckLoads[DeckId]>) => void;
  /** Forget a deck's tempo — a new record starts at its OWN. */
  clearTempo: (deck: DeckId) => void;
  /** The analysis landed: this deck's scale, home notch and beat grid. */
  measured: (deck: DeckId, tempo: DeckTempo) => void;

  nudge: (deck: DeckId, bpm: number) => void;
  release: () => void;
  toggleSync: (deck: DeckId) => void;
  crossfade: (value: number) => void;
  turnEq: (deck: DeckId, band: string, dB: number) => void;
  turnFilter: (deck: DeckId, value: number) => void;
  /** Take one instrument out of this deck's record — 0 leaves it in, 1 removes it. */
  turnStem: (deck: DeckId, stem: Stem, cut: number) => void;
  /**
   * A knob turned in the GRAPH, on a module the engine holds no plugin for.
   *
   * The declared binding read backwards: the file says which control drives `tempoA`'s
   * `Target BPM`, so a value arriving for that pair belongs to that control's deck. Which is
   * why re-pointing a line in `views/mix.yaml` moves this too.
   */
  fromGraph: (module: string, name: string, value: number) => void;
}

export function useDeckSet(
  deck: Deck,
  project: string,
  graph: WebGraph | null,
  /** The file service's change token — refetch the compile when the project moves on disk. */
  rev: string,
  /**
   * The bindings, when the HOST already holds them — an st0 surface, whose mapping is in
   * `surfaces/<id>.yaml` and which has no `views/mix.yaml` to find.
   *
   * Passed rather than read, because the two hosts keep the same map in different files and
   * only the host knows which. m9 passes nothing and the read below stays exactly what it was.
   *
   * **Keep its identity stable** — it is an effect dependency, so a fresh object every render
   * would refetch the compile every render. Both callers hold it in state, which is what makes
   * that free; a caller building one inline must `useMemo` it.
   */
  mapping?: MixViewFile,
  /**
   * The playlist this surface names, by NAME — `surfaces/<desk>.yaml`'s `playlist:`.
   *
   * Passed and not read, for the same reason `mapping` is: the declaration is the host's file,
   * and m9 has no surface folder to look in. A host that names none passes nothing, and the
   * browser says so rather than showing an empty list that looks like an empty médiathèque.
   */
  playlist?: string,
): DeckSet {
  const [loads, setLoads] = useState<DeckLoads>(NO_LOADS);
  const [faders, setFaders] = useState<DeckTempos>({});
  const [master, setMaster] = useState<DeckId | null>(null);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const [eq, setEq] = useState<Record<string, number>>({});
  const [view, setView] = useState<MixViewFile>({});
  const [compiled, setCompiled] = useState<ProjectDoc | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  /**
   * mix.yaml, held as TEXT rather than as a parsed object.
   *
   * Because writing a cue edits it in place: the file's comments are the one worked example a
   * reader of a set gets, and a desk that reprinted the file from a parse tree would eat
   * them the first time somebody dropped a cue. The text is the thing; the markers below are a
   * reading of it.
   */
  const [mixText, setMixText] = useState("");
  /** `undefined` until the read lands, and again for a surface naming no playlist — which is
   *  why the effect below sets it explicitly rather than leaving it at its initial value. */
  const [playlistText, setPlaylistText] = useState<string | null | undefined>(
    undefined,
  );
  const live = usePluginParams(deck.params);

  // The bindings and the compile, refetched when the project moves. Allowed to fail on their
  // own: a set whose project will not compile can still choose songs and play them through
  // the stand-in, and losing the desk over it would take away the screen you fix it from.
  useEffect(() => {
    let stop = false;
    void (async () => {
      // The host's own map wins, and skips the read entirely: there is no `views/mix.yaml` in
      // an st0 song, and asking for one would be a 404 on every reload of a surface.
      const v = mapping ?? (await readMixView(project));
      const cues = await readMixText(project);
      // Not read at all when the surface names none: there is no path to ask for, and a 404
      // per reload would say "missing" about a file nobody claimed existed.
      const list = playlist ? await readPlaylistText(playlist) : undefined;
      const doc = await api.engineDoc().catch(() => null);
      if (stop) return;
      setView(v);
      setMixText(cues);
      setPlaylistText(list);
      setCompiled(doc);
    })();
    return () => {
      stop = true;
    };
  }, [project, rev, mapping, playlist]);

  const wiring = useMemo(() => resolveBindings(view, graph), [view, graph]);
  const tempos = useMemo(() => syncedTempos(faders, master), [faders, master]);
  const plugins = useMemo(() => enginePluginIds(compiled), [compiled]);
  const stretches = useMemo(
    () => stretchTargets(wiring.bindings, tempos, plugins),
    [wiring, tempos, plugins],
  );
  const bindingFor = useCallback(
    (control: string) => wiring.bindings.find((b) => b.control.id === control),
    [wiring],
  );
  const mix = shownValue(bindingFor("crossfade"), held, live) ?? MIX_CENTRE;
  // Every song's cues, by ref. Re-read rather than kept beside the text, so the file stays the
  // one place a cue lives and the two can never disagree.
  const cues = useMemo(() => cueMarkers(parseMix(mixText).value), [mixText]);
  const canAlign = DECKS.every((d) => tempos[d]?.phase !== undefined);
  /**
   * Asked for, not necessarily happening. The desk can lose the right to a click under the
   * button — a second song lands, a sync is let go — and forgetting the request then would
   * mean re-arming it by hand once the situation allows it again. So the wish is kept and the
   * possibility is derived; `clicking` is their conjunction.
   */
  const [wantsClick, setWantsClick] = useState(false);
  const clickDeck = useMemo(
    () => metronomeDeck(loads, tempos, master),
    [loads, tempos, master],
  );
  const click = wantsClick ? clickDeck : null;

  // A mirror, read by `commit`. `pointerup` can arrive before React has re-rendered from the
  // last `onChange`, and a `commit` closed over that render's value would send the document
  // one drag-step stale — silently, and only sometimes.
  const latest = useRef(stretches);
  latest.current = stretches;
  /**
   * The state a STALE copy of this object must still read correctly.
   *
   * The returned functions are captured by views and called later — `measured` runs from the
   * closure of whichever render started the envelope fetch, several renders ago. Reading
   * `loads` off that closure would re-send the document WITHOUT the song just put on, which is
   * a deck that plays for a second and then goes quiet. A ref is the same object every render,
   * so a stale caller still reads what is true now.
   */
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const fadersRef = useRef(faders);
  fadersRef.current = faders;
  // …and the derivations a stale caller would otherwise map through. The compile can land
  // between putting a song on and its analysis coming back, so `measured` must resolve its
  // bindings against the project as it is NOW, not as it was when the button was pressed.
  const derived = useRef({ wiring, plugins, master });
  derived.current = { wiring, plugins, master };
  // A cue is written a second after the press, and the write is asynchronous — so the text it
  // edits has to be the one on disk NOW, not the one from the render the finger landed in.
  const mixRef = useRef(mixText);
  mixRef.current = mixText;
  const temposRef = useRef(tempos);
  temposRef.current = tempos;
  const dragging = useRef(false);
  /** What the engine was last told to stretch by — the drag compares against this, not against
   *  the previous frame, so a hand creeping in hundredths still eventually crosses. */
  const sentRef = useRef<DeckTempos>({});
  const lastWarp = useRef(0);
  const warpTimer = useRef<number | null>(null);
  const settle = useRef<number | null>(null);

  const commit = useCallback(
    (next: DeckTempos = latest.current, on: DeckLoads = loadsRef.current) => {
      // `deck.engine` is still the readiness guard — a link the host has not got yet means an
      // engine with nothing loaded, and a document sent into that is one nobody diffs against.
      // What it is NOT any more is the route: `sendProject` is, and only the host knows whether
      // that is its own socket or its file service. See `Deck.sendProject`.
      if (deck.engine)
        sendDecks(deck.sendProject, on, mix, undefined, next, compiled, click);
    },
    [deck.engine, deck.sendProject, mix, compiled, click],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // The click is in the DOCUMENT, so switching it on or off — or losing the right to it when a
  // second song lands — is a re-send and nothing else. Keyed on the deck it follows rather than
  // on the wish, so arming it while it cannot happen sends nothing.
  const sentClick = useRef<DeckId | null>(null);
  useEffect(() => {
    if (sentClick.current === click) return;
    sentClick.current = click;
    commitRef.current();
  }, [click]);

  /**
   * The drag's own sends: at most one per `LIVE_WARP_MS`, always the newest value.
   *
   * Deliberately NOT a debounce. A debounce clears its pending tick on every new value, so a
   * continuous drag never sends anything until the hand stops. Here a tick already scheduled
   * is left alone and reads `latest` when it fires.
   */
  useEffect(() => {
    if (!dragging.current || warpTimer.current !== null) return;
    const wait = Math.max(0, LIVE_WARP_MS - (Date.now() - lastWarp.current));
    warpTimer.current = window.setTimeout(() => {
      warpTimer.current = null;
      lastWarp.current = Date.now();
      if (!worthARebuild(sentRef.current, temposRef.current)) return;
      sentRef.current = temposRef.current;
      commitRef.current();
    }, wait);
  }, [stretches]);
  useEffect(
    () => () => {
      if (warpTimer.current !== null) window.clearTimeout(warpTimer.current);
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );

  // Let go of an optimistic value once the engine has caught up. One that never yields is a
  // control that has stopped listening: the engine can clamp what it was sent, and the graph
  // can move the same param.
  useEffect(() => {
    setEq((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(current)) {
        if (engineAgrees(bindingFor(id), at, live)) changed = true;
        else next[id] = at;
      }
      return changed ? next : current;
    });
    setHeld((at) =>
      at !== undefined && engineAgrees(bindingFor("crossfade"), at, live)
        ? undefined
        : at,
    );
  }, [live, bindingFor]);

  /**
   * Lend the graph what each tempo module is set to — BOTH of its numbers.
   *
   * The engine cannot answer this one: an `offline` module compiles to no plugin, so there is
   * nothing to watch and no id to watch it by. This hook is where the value exists — it is
   * what turns it into a clip warp — so it publishes, and the graph reads it off the Deck.
   *
   * A tempo node draws two: `Target BPM`, the fader, and `Source BPM`, which is a METER because
   * it is MEASURED — the song's own tempo, as the envelope reports it. Only the first is BOUND
   * (`views/mix.yaml` names one param per control), so the second is published by name here.
   * Nothing else in the repo ever wrote it, and the meter sat on 0 for every song.
   *
   * Unconditional, including when the deck has NO tempo: putting a record on clears the fader
   * (`clearTempo`) and the measurement arrives a moment later, so a publish skipped in between
   * left the graph showing the OUTGOING song's numbers — the one moment somebody is looking at
   * the node to see what they just loaded.
   *
   * Both rules live in `offlinePublish`, beside the other readings of the same file, where a
   * test can hold them. See ../docs/bpm.md.
   */
  useEffect(() => {
    for (const p of offlinePublish(wiring.bindings, tempos, TEMPO_SOURCE_PARAM))
      deck.setModuleParam(p.module, p.param, p.value);
  }, [wiring, tempos, deck.setModuleParam]);

  /** Move a control bound to a REAL plugin param. One message, per pixel. */
  const pushParam = useCallback(
    (control: string, value: number): boolean => {
      if (!deck.engine) return false;
      const b = bindingFor(control);
      if (!b || !hasPlugin(b, plugins) || !b.pluginId) return false;
      deck.engine.setPluginParam(b.pluginId, b.param, valueFor(b, value));
      return true;
    },
    [deck.engine, bindingFor, plugins],
  );

  /**
   * Where each deck is in its FILE, right now — extrapolated between the engine's pushes.
   *
   * `slipAfter` needs this and nothing else. The playhead arrives ~20×/s so the newest one can
   * be 50 ms old, which would matter to anything computing an absolute position from it; here
   * it is multiplied by a ratio change of about a hundredth, so the same staleness is worth
   * half a millisecond. Carrying it forward anyway costs one subtraction.
   */
  const sourceOf = useCallback(
    (deckId: DeckId) => {
      const p = deck.playhead.current;
      const at =
        p.seconds + (deck.playing ? (performance.now() - p.at) / 1000 : 0);
      return sourceAt(at, temposRef.current[deckId]);
    },
    [deck.playhead, deck.playing],
  );

  const nudge = useCallback(
    (deckId: DeckId, bpm: number) => {
      dragging.current = true;
      if (master && master !== deckId) setMaster(null);
      // Through `nudgedTempos` rather than by writing `target`: moving a fader also moves where
      // the deck's clip has to SIT, or the music jumps — see `slipAfter`. Both masters are
      // handed over because a hand on the slave's fader cancels the sync, and what the decks
      // were playing at a moment ago is only readable with it still on.
      const next = master && master !== deckId ? null : master;
      setFaders((f) => nudgedTempos(f, master, next, deckId, bpm, sourceOf));
    },
    [master, sourceOf],
  );

  const release = useCallback(() => {
    dragging.current = false;
    lastWarp.current = Date.now();
    // Unconditional, unlike the drag's own sends: the value let go of is the one that must be
    // true afterwards, however small the last movement was.
    sentRef.current = temposRef.current;
    commitRef.current();
  }, []);

  return {
    loads,
    tempos,
    master,
    mix,
    problems: wiring.problems,
    deskError,
    canAlign,
    clickDeck,
    clicking: click !== null,
    toggleMetronome: () => setWantsClick((on) => !on),

    eqOf: (deckId) =>
      Object.fromEntries(
        EQ_BANDS.map((b) => {
          const id = `${deckId}.${b.id}`;
          return [b.id, shownValue(bindingFor(id), eq[id], live)];
        }).filter(([, v]) => v !== undefined),
      ),
    eqLive: (deckId) =>
      EQ_BANDS.some((b) => {
        const x = bindingFor(`${deckId}.${b.id}`);
        return !!x && hasPlugin(x, plugins);
      }),

    // The filter rides the same two rails as the EQ — an optimistic value over the engine's —
    // because it is the same kind of thing: a real plugin param, sent per pixel.
    filterOf: (deckId) => {
      const id = `${deckId}.filter`;
      return shownValue(bindingFor(id), eq[id], live);
    },
    filterLive: (deckId) => {
      const x = bindingFor(`${deckId}.filter`);
      return !!x && hasPlugin(x, plugins);
    },

    // The stem cuts ride the same two rails as the EQ — an optimistic value over the engine's —
    // because they are the same kind of thing: a real plugin param, sent per pixel. Each names
    // its OWN module, where the EQ's three share one, so `stemLive` asks about any of the four.
    stemsOf: (deckId) =>
      Object.fromEntries(
        STEMS.map((s) => {
          const id = stemControl(deckId, s);
          return [s, shownValue(bindingFor(id), eq[id], live)];
        }).filter(([, v]) => v !== undefined),
      ),
    stemLive: (deckId) =>
      STEMS.some((s) => {
        const x = bindingFor(stemControl(deckId, s));
        return !!x && hasPlugin(x, plugins);
      }),
    // The FILE's half of the same question, and a different sentence for the person: the knobs
    // are wired, but this record has never been separated, so there is nothing to take out of it.
    stemsReady: (deckId) => !!loads[deckId]?.stems,

    mixText,
    playlistText,

    cuesOf: (deckId) => {
      const id = loads[deckId]?.id;
      return id ? (cues[`@st0/${id}`] ?? []) : [];
    },

    setCue: (deckId, slot, transportSeconds) => {
      const load = loadsRef.current[deckId];
      if (!load) return;
      const ref = `@st0/${load.id}`;
      // The FILE's clock, not the transport's — see `sourceAt`. A cue stored as a timeline
      // position would move the moment somebody touched this deck's tempo fader.
      const at = sourceAt(transportSeconds, temposRef.current[deckId]);
      const next = [...(cues[ref] ?? [])];
      while (next.length <= slot) next.push(null);
      next[slot] = at;

      // The text on disk is edited, never reprinted from a parse — the file's comments are the
      // worked example, and losing them to a cue would be a poor trade.
      const text = withMarkers(mixRef.current, ref, next);
      setMixText(text);
      void writeMixText(project, text).catch((e: Error) =>
        // Said out loud: the button has already gone coloured, so a silent failure would leave
        // a cue that is there until the next reload and then is not.
        setDeskError(
          `le repère n'a pas pu être écrit dans ${MIX_FILE} : ${e.message}`,
        ),
      );
    },

    jumpCue: (deckId, slot) => {
      const id = loadsRef.current[deckId]?.id;
      const at = id ? cues[`@st0/${id}`]?.[slot] : null;
      if (at == null || !deck.engine) return;
      // One transport for both decks (docs/mix.md), so this moves the OTHER deck too. That is
      // the engine m9 has, and a cue is still worth having on it.
      deck.engine.seek(transportAt(at, temposRef.current[deckId]));
    },

    toggleTransport: () => {
      const e = deck.engine;
      if (!e) return;
      if (deck.playing) return e.transport("stop");
      // The RAW anchor, not `drawNow`: this decides whether to move the transport, and the
      // steered reader is allowed to be up to 10% out for the sake of drawing smoothly.
      const from = playFrom(deck.playhead.current.seconds);
      if (from !== null) e.seek(from);
      e.transport("play");
    },

    putOn: (deckId, load) => {
      setDeskError(null);
      const next: DeckLoads = { ...loadsRef.current, [deckId]: load };
      setLoads(next);
      commitRef.current(latest.current, next);
      /**
       * …and put the transport where the music is, if it is not already.
       *
       * This asked `empty` — "were both decks unloaded before this one?" — which answers a
       * question about THIS TAB's history rather than about where the transport is. Reload the
       * page and the decks come back empty while the engine still holds their clips, so the
       * second song of the evening finds `empty` false, nothing seeks, and Play rolls silently
       * through the ten minutes of nothing before `TIMELINE_BASE`.
       *
       * Asking the transport instead is both simpler and safer: it seeks exactly when the
       * position is in that dead zone, and it can never yank a playing deck back to its top —
       * a deck that is playing is already past `TIMELINE_BASE`, so `playFrom` answers null.
       */
      const from = playFrom(deck.playhead.current.seconds);
      if (from !== null && deck.engine) deck.engine.seek(from);
    },
    stemsArrived: (deckId, id) => {
      const load = loadsRef.current[deckId];
      // Off the REF and against the id it was started for: a separation runs for minutes, so the
      // record may have been taken off and another put on. Filling the lanes then would put four
      // clips of the wrong song's bass under the one playing, silently.
      if (!load || load.stems || load.id !== id) return;
      const next: DeckLoads = {
        ...loadsRef.current,
        [deckId]: { ...load, stems: true },
      };
      setLoads(next);
      commitRef.current(latest.current, next);
    },
    clearTempo: (deckId) => setFaders((f) => ({ ...f, [deckId]: undefined })),
    measured: (deckId, tempo) => {
      const merged = { ...fadersRef.current, [deckId]: tempo };
      setFaders(merged);
      // Re-sent so the OTHER deck's stretch survives this load: the document carries both
      // warps, and one built without this deck's tempo would drop the other's. The freshly
      // measured tempo has not reached `stretches` yet, so the mapping is done inline.
      const d = derived.current;
      commitRef.current(
        stretchTargets(
          d.wiring.bindings,
          syncedTempos(merged, d.master),
          d.plugins,
        ),
      );
    },

    nudge,
    release,
    toggleSync: (deckId) => {
      const next = master === deckId ? null : deckId;
      setMaster(next);
      const d = derived.current;
      commitRef.current(
        stretchTargets(
          d.wiring.bindings,
          syncedTempos(fadersRef.current, next),
          d.plugins,
        ),
      );
    },
    crossfade: (value) => {
      setHeld(value);
      if (!deck.engine) return;
      // THE DECLARED PATH: `views/mix.yaml` says this fader is the crossfade module's `Mix`,
      // and the compiled document is what put that module in the engine.
      if (pushParam("crossfade", value)) return;
      // …and the stand-in, for the seconds before the compile lands or a project that will
      // not compile: no crossfade module in the engine, so the two decks' levels move.
      if (!compiled) return pushCrossfade(deck.engine, value);
      // Compiled, but nothing bound to a plugin the engine has. The levels the stand-in moves
      // are not in THIS document, so moving them would do nothing at all — and a crossfader
      // that silently does nothing is the exact bug this whole file keeps paying for.
      setDeskError(
        `le crossfade n'est lié à aucun plugin chargé — vérifiez ${MIX_VIEW_FILE}`,
      );
    },
    turnEq: (deckId, band, dB) => {
      const id = `${deckId}.${band}`;
      setEq((e) => ({ ...e, [id]: dB }));
      pushParam(id, dB);
    },
    turnFilter: (deckId, value) => {
      const id = `${deckId}.filter`;
      setEq((e) => ({ ...e, [id]: value }));
      pushParam(id, value);
    },
    turnStem: (deckId, stem, cut) => {
      const id = stemControl(deckId, stem);
      setEq((e) => ({ ...e, [id]: cut }));
      pushParam(id, cut);
    },

    fromGraph: (module, name, value) => {
      const b = controlDriving(wiring.bindings, module, name);
      if (!b) return;
      nudge(b.control.id.split(".")[0] as DeckId, value);
      // The graph reports no release, so the settle timer is what lands the exact value the
      // knob was let go on — the throttle above may have stopped a frame short of it.
      if (settle.current !== null) window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        settle.current = null;
        release();
      }, GRAPH_SETTLE_MS);
    },
  };
}
