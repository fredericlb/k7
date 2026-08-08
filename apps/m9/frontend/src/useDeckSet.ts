// useDeckSet.ts — the two decks as a DOCUMENT: what is on them, what they play at, and every
// gesture that changes either. Held by Studio, not by a view, so it outlives the tab you are
// looking at. See docs/deckSet.md.

import { usePluginParams } from "@studio/engine-browser/params";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
import type { MixView as MixViewFile } from "@studio/song/yaml/mixViewSchema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  type DeckId,
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  DECKS,
  EQ_BANDS,
  MIX_CENTRE,
  NO_LOADS,
  pushCrossfade,
  sendDecks,
  syncedTempos,
} from "./deck";
import {
  type BindingProblem,
  controlDriving,
  engineAgrees,
  enginePluginIds,
  hasPlugin,
  resolveBindings,
  shownValue,
  stretchTargets,
  valueFor,
} from "./mixBindings";
import { MIX_VIEW_FILE, readMixView } from "./mixView";
import type { Deck } from "./useEngine";

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
 * How long after the last tempo a gesture from the GRAPH is considered over.
 *
 * The desk knows: a fader sends `pointerup`. The graph's knob does not report a release to its
 * host, so the trailing commit is timed instead — long enough not to fire mid-drag, short
 * enough that the exact value it was let go on lands promptly.
 */
const GRAPH_SETTLE_MS = 250;

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
  /** Can sync do its second half — put the two decks' beats together? */
  canAlign: boolean;

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
): DeckSet {
  const [loads, setLoads] = useState<DeckLoads>(NO_LOADS);
  const [faders, setFaders] = useState<DeckTempos>({});
  const [master, setMaster] = useState<DeckId | null>(null);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const [eq, setEq] = useState<Record<string, number>>({});
  const [view, setView] = useState<MixViewFile>({});
  const [compiled, setCompiled] = useState<ProjectDoc | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const live = usePluginParams(deck.params);

  // The bindings and the compile, refetched when the project moves. Allowed to fail on their
  // own: a set whose project will not compile can still choose songs and play them through
  // the stand-in, and losing the desk over it would take away the screen you fix it from.
  useEffect(() => {
    let stop = false;
    void (async () => {
      const v = await readMixView(project);
      const doc = await api.engineDoc().catch(() => null);
      if (stop) return;
      setView(v);
      setCompiled(doc);
    })();
    return () => {
      stop = true;
    };
  }, [project, rev]);

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
  const canAlign = DECKS.every((d) => tempos[d]?.phase !== undefined);

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
  const dragging = useRef(false);
  const lastWarp = useRef(0);
  const warpTimer = useRef<number | null>(null);
  const settle = useRef<number | null>(null);

  const commit = useCallback(
    (next: DeckTempos = latest.current, on: DeckLoads = loadsRef.current) => {
      if (deck.engine)
        sendDecks(deck.engine, on, mix, undefined, next, compiled);
    },
    [deck.engine, mix, compiled],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

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
   * Lend the graph what each tempo module is set to.
   *
   * The engine cannot answer this one: an `offline` module compiles to no plugin, so there is
   * nothing to watch and no id to watch it by. This hook is where the value exists — it is
   * what turns it into a clip warp — so it publishes, and the graph reads it off the Deck.
   */
  useEffect(() => {
    for (const b of wiring.bindings) {
      if (b.pluginId) continue; // a real plugin — the engine reports that one itself
      const t = tempos[b.control.id.split(".")[0] as DeckId];
      if (t) deck.setModuleParam(b.module, b.param, t.target);
    }
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

  const nudge = useCallback(
    (deckId: DeckId, bpm: number) => {
      dragging.current = true;
      if (master && master !== deckId) setMaster(null);
      setFaders((f) => {
        const t = f[deckId];
        return t ? { ...f, [deckId]: { ...t, target: bpm } } : f;
      });
    },
    [master],
  );

  const release = useCallback(() => {
    dragging.current = false;
    lastWarp.current = Date.now();
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

    putOn: (deckId, load) => {
      setDeskError(null);
      const next: DeckLoads = { ...loadsRef.current, [deckId]: load };
      setLoads(next);
      commitRef.current(latest.current, next);
    },
    clearTempo: (deckId) =>
      setFaders((f) => ({ ...f, [deckId]: undefined })),
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
