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
import { alignSeek } from "./beats";
import {
  DECKS,
  type DeckId,
  type DeckLoads,
  type DeckPlaying,
  type DeckTempo,
  type DeckTempos,
  deckRunning,
  EQ_BANDS,
  MIX_CENTRE,
  metronomeDeck,
  NO_LOADS,
  nudgedTempos,
  platterKey,
  platterRate,
  plattersOf,
  pushCrossfade,
  scratchDelay,
  sendDecks,
  syncedTempos,
  TEMPO_SOURCE_PARAM,
  withKeylock,
} from "./deck";
import type { Deck } from "./engine";
import {
  type BindingProblem,
  controlDriving,
  engineAgrees,
  enginePluginIds,
  hasPlugin,
  leavesByItsOwnPair,
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

/** How often a tempo may reach the engine while a control moves — a rate rides in the document, docs/bpm.md. */
const LIVE_WARP_MS = 120;

/** How far a tempo must move for the drag to send again — under this nobody hears it, docs/bpm.md. */
const LIVE_WARP_BPM = 0.05;

/** How long after the last tempo a gesture from the GRAPH is over — it reports no release, docs/deckSet.md. */
const GRAPH_SETTLE_MS = 250;

/** Has any deck's tempo moved far enough since the last send to be worth another document? */
function worthARebuild(sent: DeckTempos, now: DeckTempos): boolean {
  return DECKS.some((d) => {
    const a = sent[d];
    const b = now[d];
    if (!a || !b) return a !== b; // a deck appearing or leaving is not a fader movement
    return (
      Math.abs(a.target - b.target) >= LIVE_WARP_BPM || a.natural !== b.natural
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
  /** Does the PROJECT wire a headphone send for this deck, and has the engine loaded it? */
  cueWired: (deck: DeckId) => boolean;
  /** …and can this MACHINE play it — i.e. has it named a pair? Both, or the button lights and lies. */
  cueLive: (deck: DeckId) => boolean;
  /** …and is it open right now? */
  cueOn: (deck: DeckId) => boolean;
  /** How much of each stem this deck is REMOVING, 0..1 by stem. Absent is none of it. */
  stemsOf: (deck: DeckId) => Partial<Record<Stem, number>>;
  /** Does this deck have stem cuts the engine has actually loaded? False on a set that wires none. */
  stemLive: (deck: DeckId) => boolean;
  /** …and whether the record on it has stems to subtract — wired but unprepared is an ordinary state. */
  stemsReady: (deck: DeckId) => boolean;
  /** The separation landed: re-send with `stems: true` so `withDecks` finds four more clips (docs/stems.md). */
  stemsArrived: (deck: DeckId, id: string) => void;
  /** Can sync do its second half — put the two decks' beats together? */
  canAlign: boolean;

  /** Which deck's beat a click WOULD follow, or null when the desk cannot offer one — `metronomeDeck` holds the rule. */
  clickDeck: DeckId | null;
  /** Is it on? False whenever `clickDeck` is null, whatever was asked for before. */
  clicking: boolean;
  toggleMetronome: () => void;

  /** mix.yaml as it stands on disk — the CUE sheet, and what a cue is written back into. */
  mixText: string;
  /** The set list as text: `undefined` names no playlist, `null` is one not on disk (docs/setList.md). */
  playlistText: string | null | undefined;
  /** This deck's eight cue slots, positional. `null` is an empty button. */
  cuesOf: (deck: DeckId) => (number | null)[];
  /** Drop a cue where the press BEGAN, in seconds of the FILE — the deck's own needle, docs/cues.md. */
  setCue: (deck: DeckId, slot: number, sourceSeconds: number) => void;
  /** Send the transport to one. Nothing happens on an empty slot. */
  jumpCue: (deck: DeckId, slot: number) => void;

  /** Start both decks, or stop them — a transport RULE, not a click handler: play starts where the music is. */
  toggleTransport: () => void;

  /** Put a song on a deck and send it. */
  putOn: (deck: DeckId, load: NonNullable<DeckLoads[DeckId]>) => void;
  /** Forget a deck's tempo — a new record starts at its OWN. */
  clearTempo: (deck: DeckId) => void;
  /** Is this deck holding the pitch while the tempo moves? — docs/bpm.md. */
  keylock: (deck: DeckId) => boolean;
  toggleKeylock: (deck: DeckId) => void;
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
  /** Put this deck in the headphones, or take it out — pre-fade, so the crossfader does not touch it. */
  toggleCue: (deck: DeckId) => void;
  /** Drop this deck's needle on a second of its RECORD. The other deck does not move — docs/scratch.md. */
  place: (deck: DeckId, source: number) => void;
  /** Shove it by `seconds`, signed — the same mechanism said as a push. NOT `nudge`, which is the pitch fader. */
  shove: (deck: DeckId, seconds: number) => void;
  /** Where this deck's needle is in its FILE right now — what a scrub draws while it drags. */
  sourceNow: (deck: DeckId) => number;
  /** Is this deck turning? Its platter's own answer — the one transport speaks for none of them. */
  running: (deck: DeckId) => boolean;
  /** Start or stop THIS deck — its platter's `Rate`, which the one transport does not decide (docs/turntable.md). */
  toggleDeck: (deck: DeckId) => void;
  /** Drive the record by hand: a signed rate, or `null` to hand it back to what it was doing. */
  scratch: (deck: DeckId, rate: number | null) => void;
  /** Can it be scratched at all? Only an EMPTY deck cannot — everything else is on a platter. */
  canScratch: (deck: DeckId) => boolean;
  /** …and whether it may be, which is what greys the button rather than letting it lie. */
  canStartAlone: (deck: DeckId) => boolean;
  /** A knob turned in the GRAPH: the declared binding read backwards — see docs/deckSet.md. */
  fromGraph: (module: string, name: string, value: number) => void;
}

export function useDeckSet(
  deck: Deck,
  project: string,
  graph: WebGraph | null,
  /** The file service's change token — refetch the compile when the project moves on disk. */
  rev: string,
  /** The bindings, when the HOST already holds them — keep its identity stable, see docs/deckSet.md. */
  mapping?: MixViewFile,
  /** The playlist this surface names, by NAME — passed and not read, same reason as `mapping`. */
  playlist?: string,
): DeckSet {
  const [loads, setLoads] = useState<DeckLoads>(NO_LOADS);
  const [faders, setFaders] = useState<DeckTempos>({});
  const [master, setMaster] = useState<DeckId | null>(null);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const [eq, setEq] = useState<Record<string, number>>({});
  /** Which decks the USER has started. A platter carries its own transport — see docs/turntable.md. */
  const [started, setStarted] = useState<DeckPlaying>({});
  const [view, setView] = useState<MixViewFile>({});
  const [compiled, setCompiled] = useState<ProjectDoc | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  /** mix.yaml as TEXT, because writing a cue edits it in place and keeps its comments (docs/cues.md). */
  const [mixText, setMixText] = useState("");
  /** `undefined` until the read lands, and again for a surface naming no playlist — so the effect sets it. */
  const [playlistText, setPlaylistText] = useState<string | null | undefined>(
    undefined,
  );
  const live = usePluginParams(deck.params);

  // The bindings and the compile, refetched when the project moves — each allowed to fail alone.
  useEffect(() => {
    let stop = false;
    void (async () => {
      // The host's own map wins and skips the read: an st0 song has no `views/mix.yaml` to ask for.
      const v = mapping ?? (await readMixView(project));
      const cues = await readMixText(project);
      // Not read when the surface names none: a 404 per reload would say "missing" about an unclaimed file.
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
  // A DECK's switch, so it survives the record on it — `clearTempo` wipes the tempo and not this.
  const [keylocks, setKeylocks] = useState<Partial<Record<DeckId, boolean>>>(
    {},
  );
  const tempos = useMemo(
    () => withKeylock(syncedTempos(faders, master), keylocks),
    [faders, master, keylocks],
  );
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
  // Every song's cues, by ref — re-read from the text, so the file stays the one place a cue lives.
  const cues = useMemo(() => cueMarkers(parseMix(mixText).value), [mixText]);
  const canAlign = DECKS.every((d) => tempos[d]?.phase !== undefined);
  // Asked for, not necessarily happening: the wish is kept and the possibility derived (docs/metronome.md).
  const [wantsClick, setWantsClick] = useState(false);
  const clickDeck = useMemo(
    () => metronomeDeck(loads, tempos, master),
    [loads, tempos, master],
  );
  const click = wantsClick ? clickDeck : null;

  /** Which decks are ACTUALLY turning. Every platter answers for itself; the transport commands none. */
  const running: DeckPlaying = useMemo(
    () =>
      Object.fromEntries(
        DECKS.map((d) => [d, deckRunning(d, started, loads[d])]),
      ),
    [started, loads],
  );
  const runningRef = useRef(running);
  runningRef.current = running;

  // A mirror read by `commit`: `pointerup` can beat React's re-render, and a stale closure sends one step old.
  const latest = useRef(stretches);
  latest.current = stretches;
  // The state a STALE copy of this object must still read correctly — see docs/deckSet.md.
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const fadersRef = useRef(faders);
  fadersRef.current = faders;
  const keylocksRef = useRef(keylocks);
  keylocksRef.current = keylocks;
  // …and the derivations a stale caller would otherwise map through, for the same reason.
  const derived = useRef({ wiring, plugins, master });
  derived.current = { wiring, plugins, master };
  // A cue is written a second after the press, so the text it edits must be the one on disk NOW.
  const mixRef = useRef(mixText);
  mixRef.current = mixText;
  const temposRef = useRef(tempos);
  temposRef.current = tempos;
  const dragging = useRef(false);
  /** Which decks have a hand on them — so KEY is switched twice per gesture and not sixty times a second. */
  const scratching = useRef<Partial<Record<DeckId, boolean>>>({});
  /** The scratch throttle: when the last rate went out, the newest one waiting, and the timer carrying it. */
  const lastScratch = useRef(0);
  const scratchWaiting = useRef<Partial<Record<DeckId, number>>>({});
  const scratchTimer = useRef<number | null>(null);
  /** What the engine was last told to stretch by — the drag compares against this, not the previous frame. */
  const sentRef = useRef<DeckTempos>({});
  const lastWarp = useRef(0);
  const warpTimer = useRef<number | null>(null);
  const settle = useRef<number | null>(null);

  /** One scratch, straight at the platters. The THROTTLE is above it — docs/scratch.md. */
  const sendScratch = (deckId: DeckId, rate: number | null) => {
    const platters = deck.engine
      ? plattersOf(deckId, loadsRef.current[deckId])
      : [];
    if (!platters.length) return;
    // A hand on the record is a VARISPEED, always — `platterKey` is where that rule lives.
    const holding = rate !== null;
    const key = !!scratching.current[deckId] !== holding;
    if (key) scratching.current[deckId] = holding;
    // Letting go hands it back to whatever it was doing — the rate the DOCUMENT would have sent.
    const back = platterRate(
      temposRef.current[deckId],
      !!runningRef.current[deckId],
    );
    for (const id of platters) {
      if (key)
        deck.engine?.setPluginParam(
          id,
          "Key",
          platterKey(temposRef.current[deckId], holding),
        );
      deck.engine?.setPluginParam(id, "Rate", rate === null ? back : rate);
    }
  };

  const commit = useCallback(
    (next: DeckTempos = latest.current, on: DeckLoads = loadsRef.current) => {
      // `deck.engine` is the readiness guard and not the route — `sendProject` is, see `Deck.sendProject`.
      if (deck.engine)
        sendDecks(
          deck.sendProject,
          on,
          mix,
          undefined,
          next,
          compiled,
          click,
          // A PLATTER has no transport to read, so which decks turn rides in the document.
          runningRef.current,
        );
    },
    [deck.engine, deck.sendProject, mix, compiled, click],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  /** A deck's needle onto second `source` of its record, the TRANSPORT untouched — docs/turntable.md, in the engine. */
  /** A repeated seek made distinguishable: a param is a level, so cue 1 twice would jump once. */
  const seekWobble = useRef(0);

  const place = useCallback(
    (deckId: DeckId, source: number) => {
      const stored = fadersRef.current[deckId];
      // No measured length yet means no fraction to seek by, and a guess would drop the needle elsewhere.
      if (!stored || !(stored.seconds > 0) || !deck.engine) return;
      seekWobble.current = seekWobble.current ? 0 : 1e-9;
      const at =
        Math.min(1, Math.max(0, source / stored.seconds)) + seekWobble.current;
      // ALL of them: a separated record is four platters that must land on the same groove.
      for (const id of plattersOf(deckId, loadsRef.current[deckId]))
        deck.engine.setPluginParam(id, "Seek", at);
    },
    [deck.engine],
  );
  const placeRef = useRef(place);
  placeRef.current = place;

  /** A deck's needle in its RECORD, off its platter's own clock — the one position reader there is. */
  const needle = useCallback(
    (deckId: DeckId): number => {
      // The FIRST of them: four parts share a position, so asking one is asking all four.
      const [first] = plattersOf(deckId, loadsRef.current[deckId]);
      return (first && deck.platters.current?.[first]) || 0;
    },
    [deck.platters],
  );
  const needleRef = useRef(needle);
  needleRef.current = needle;

  // The click is in the DOCUMENT, so it is a re-send; keyed on the deck it follows, not on the wish.
  const sentClick = useRef<DeckId | null>(null);
  useEffect(() => {
    if (sentClick.current === click) return;
    sentClick.current = click;
    commitRef.current();
  }, [click]);

  // …and so is a platter's `Rate`: starting a deck is a document, not a transport verb.
  const sentRunning = useRef("");
  useEffect(() => {
    const key = DECKS.map((d) => (running[d] ? "1" : "0")).join("");
    if (sentRunning.current === key) return;
    sentRunning.current = key;
    commitRef.current();
  }, [running]);

  // The drag's own sends: a throttle, deliberately not a debounce — see docs/bpm.md.
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
      if (scratchTimer.current !== null)
        window.clearTimeout(scratchTimer.current);
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );

  // Let go of an optimistic value once the engine has caught up — one that never yields has stopped listening.
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

  // Lend the graph both of each tempo module's numbers, unconditionally — see docs/bpm.md.
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
      // The SAME value to the second target: the opposition lives in the modules, not here.
      if (b.also?.pluginId && plugins.has(b.also.pluginId))
        deck.engine.setPluginParam(
          b.also.pluginId,
          b.also.param,
          valueFor({ ...b.also, control: b.control }, value),
        );
      return true;
    },
    [deck.engine, bindingFor, plugins],
  );

  const nudge = useCallback(
    (deckId: DeckId, bpm: number) => {
      dragging.current = true;
      // Moving a SLAVE's fader takes the lead away from the other deck: one hand, one tempo.
      if (master && master !== deckId) setMaster(null);
      setFaders((f) => nudgedTempos(f, deckId, bpm));
    },
    [master],
  );

  const release = useCallback(() => {
    dragging.current = false;
    lastWarp.current = Date.now();
    // Unconditional, unlike the drag's own sends: the value let go of must be true afterwards.
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

    // The filter rides the same two rails as the EQ: a real plugin param, sent per pixel.
    filterOf: (deckId) => {
      const id = `${deckId}.filter`;
      return shownValue(bindingFor(id), eq[id], live);
    },
    filterLive: (deckId) => {
      const x = bindingFor(`${deckId}.filter`);
      return !!x && hasPlugin(x, plugins);
    },

    // The headphone send rides the same rails again — and unwired is an ordinary state here (docs/cue.md).
    cueWired: (deckId) => {
      const x = bindingFor(`${deckId}.cue`);
      return !!x && hasPlugin(x, plugins);
    },
    // …plus the machine's half: a loaded send with nowhere to go would be a button that lit and lied.
    cueLive: (deckId) => {
      const x = bindingFor(`${deckId}.cue`);
      return !!x && hasPlugin(x, plugins) && leavesByItsOwnPair(x, compiled);
    },
    cueOn: (deckId) => (eq[`${deckId}.cue`] ?? 0) > 0.5,

    // Same two rails as the EQ, but each cut names its OWN module, so `stemLive` asks about any of the four.
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
    // The FILE's half of the same question: the knobs are wired, but this record was never separated.
    stemsReady: (deckId) => !!loads[deckId]?.stems,

    mixText,
    playlistText,

    cuesOf: (deckId) => {
      const id = loads[deckId]?.id;
      return id ? (cues[`@st0/${id}`] ?? []) : [];
    },

    setCue: (deckId, slot, at) => {
      const load = loadsRef.current[deckId];
      if (!load) return;
      const ref = `@st0/${load.id}`;
      const next = [...(cues[ref] ?? [])];
      while (next.length <= slot) next.push(null);
      next[slot] = at;

      // The text on disk is edited, never reprinted from a parse — its comments are the worked example.
      const text = withMarkers(mixRef.current, ref, next);
      setMixText(text);
      void writeMixText(project, text).catch((e: Error) =>
        // Said out loud: the button has already gone coloured, so a silent failure would lose the cue.
        setDeskError(
          `le repère n'a pas pu être écrit dans ${MIX_FILE} : ${e.message}`,
        ),
      );
    },

    place: (deckId, source) => placeRef.current(deckId, source),
    // Signed seconds off where it is NOW — read through the deck's own needle, whichever way it plays.
    shove: (deckId, seconds) =>
      placeRef.current(deckId, needleRef.current(deckId) + seconds),
    sourceNow: (deckId) => needleRef.current(deckId),
    running: (deckId) => !!running[deckId],
    canStartAlone: (deckId) => !!loadsRef.current[deckId],
    // Every record is on a platter now, so the only thing that cannot be scratched is an empty deck.
    canScratch: (deckId) => !!loadsRef.current[deckId],
    scratch: (deckId, rate) => {
      // Letting go is never delayed and never dropped: it is what hands the record back — docs/scratch.md.
      if (rate === null) {
        if (scratchTimer.current !== null) {
          window.clearTimeout(scratchTimer.current);
          scratchTimer.current = null;
        }
        scratchWaiting.current = {};
        sendScratch(deckId, null);
        return;
      }
      const now = performance.now();
      const wait = scratchDelay(now - lastScratch.current, rate);
      if (wait <= 0) {
        lastScratch.current = now;
        sendScratch(deckId, rate);
        return;
      }
      // Too soon: keep the NEWEST rate and let the timer carry it, so the hand's last position wins.
      scratchWaiting.current[deckId] = rate;
      if (scratchTimer.current !== null) return;
      scratchTimer.current = window.setTimeout(() => {
        scratchTimer.current = null;
        lastScratch.current = performance.now();
        const due = scratchWaiting.current;
        scratchWaiting.current = {};
        for (const [d, r] of Object.entries(due)) sendScratch(d as DeckId, r);
      }, wait);
    },
    toggleDeck: (deckId) => {
      // An empty deck has no platter to start, and the transport is not one either.
      if (!loadsRef.current[deckId]) return;
      setStarted((s) => ({ ...s, [deckId]: !s[deckId] }));
    },

    jumpCue: (deckId, slot) => {
      const id = loadsRef.current[deckId]?.id;
      const at = id ? cues[`@st0/${id}`]?.[slot] : null;
      if (at == null) return;
      // The PLATTER moves, never the transport — which is why this leaves the other deck alone.
      placeRef.current(deckId, at);
    },

    toggleTransport: () => {
      const e = deck.engine;
      if (!e) return;
      const go = !deck.playing;
      // BOTH: a platter takes no orders from the transport, so moving it alone started nothing.
      setStarted(Object.fromEntries(DECKS.map((d) => [d, go])));
      if (!go) return e.transport("stop");
      // From zero: the only thing left on the timeline is the click, and it starts there (docs/metronome.md).
      e.seek(0);
      e.transport("play");
    },

    putOn: (deckId, load) => {
      setDeskError(null);
      const next: DeckLoads = { ...loadsRef.current, [deckId]: load };
      setLoads(next);
      commitRef.current(latest.current, next);
    },
    stemsArrived: (deckId, id) => {
      const load = loadsRef.current[deckId];
      // Off the REF and against the id it was started for — a separation runs for minutes (docs/stems.md).
      if (!load || load.stems || load.id !== id) return;
      const next: DeckLoads = {
        ...loadsRef.current,
        [deckId]: { ...load, stems: true },
      };
      setLoads(next);
      commitRef.current(latest.current, next);
    },
    clearTempo: (deckId) => setFaders((f) => ({ ...f, [deckId]: undefined })),
    keylock: (deckId) => !!keylocks[deckId],
    toggleKeylock: (deckId) => {
      const next = {
        ...keylocksRef.current,
        [deckId]: !keylocksRef.current[deckId],
      };
      setKeylocks(next);
      // Re-sent inline for the reason `measured` is: the warp is a DOCUMENT change, and `latest` is a render late.
      const d = derived.current;
      commitRef.current(
        stretchTargets(
          d.wiring.bindings,
          withKeylock(syncedTempos(fadersRef.current, d.master), next),
          d.plugins,
        ),
      );
    },
    measured: (deckId, tempo) => {
      const merged = { ...fadersRef.current, [deckId]: tempo };
      setFaders(merged);
      // Re-sent so the OTHER deck's stretch survives this load — mapped inline, `stretches` is a render late.
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
      // A PLATTER has no clip to delay, so its beats are put together by SEEKING — after the tempos.
      const lead = next && temposRef.current[next];
      if (!next || !lead) return;
      for (const slave of DECKS) {
        const behind = temposRef.current[slave];
        if (slave === next || !behind || !loadsRef.current[slave]) continue;
        const to = alignSeek(lead, behind, {
          master: needleRef.current(next),
          slave: needleRef.current(slave),
        });
        // Null is a deck whose grid nobody could measure — the tempo still matched, docs/bpm.md.
        if (to !== null) placeRef.current(slave, to);
      }
    },
    crossfade: (value) => {
      setHeld(value);
      if (!deck.engine) return;
      // THE DECLARED PATH: `views/mix.yaml` says this fader is the crossfade module's `Mix`.
      if (pushParam("crossfade", value)) return;
      // …and the stand-in, before the compile lands: no crossfade module, so the two decks' levels move.
      if (!compiled) return pushCrossfade(deck.engine, value);
      // Compiled but bound to no loaded plugin — the stand-in's levels are not in THIS document.
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
    toggleCue: (deckId) => {
      const id = `${deckId}.cue`;
      // A send's gain, 0 or 1 — the button holds no state of its own, it reads the value it wrote.
      const next = (eq[id] ?? 0) > 0.5 ? 0 : 1;
      setEq((e) => ({ ...e, [id]: next }));
      // Unwired is not an error here: a machine with one output pair has no headphone bus to open.
      pushParam(id, next);
    },

    fromGraph: (module, name, value) => {
      const b = controlDriving(wiring.bindings, module, name);
      if (!b) return;
      nudge(b.control.id.split(".")[0] as DeckId, value);
      // The graph reports no release, so the settle timer lands the exact value the knob was let go on.
      if (settle.current !== null) window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        settle.current = null;
        release();
      }, GRAPH_SETTLE_MS);
    },
  };
}
