// engine.ts — the SEAM: what the desk needs from an engine, and nothing about how a host got
// one. m9 satisfies it with its own `useEngine` (its registry, its session, its lease); l8
// satisfies it from the link its shell already holds. Types only. See docs/hosting.md.

import type { EngineClient } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { ClaimLostReason } from "@studio/engine-browser/registry";
import type { ProjectDoc } from "@studio/engine-protocol/project";

/**
 * How far along the host is in getting an engine, and why it failed if it did.
 *
 * The desk draws each of these differently — "looking" is a spinner, "taken" is a sentence
 * naming who holds the machine — so it cannot be collapsed to a boolean. A host that has no
 * such notion (an engine it simply holds) reports `ready` and never anything else.
 */
export type Phase =
  | { k: "looking" }
  | { k: "absent" }
  // The claim is gone. Terminal: the deck stops driving and says WHICH of the three happened.
  | { k: "taken"; heldBy: string; why: ClaimLostReason; tookFor: string | null }
  | { k: "ready"; id: string };

/** The transport's position, and the moment it was heard — see the note where it is set. */
export interface Playhead {
  seconds: number;
  /** `performance.now()` when this arrived, so a reader can extrapolate between pushes. */
  at: number;
}

/**
 * The engine, as the desk sees it.
 *
 * It was m9's `useEngine` return type and is unchanged, deliberately: this extraction moved
 * the desk, not its contract. What made it a seam rather than a refactor is that nothing in
 * here names m9 — no registry, no session id, no `/m9` prefix, no lease. Those are how a host
 * OBTAINS an engine, which is exactly the part that differs between the two, and none of it
 * was in the type. See docs/hosting.md for what a
 * host owes this package.
 */
export interface Deck {
  phase: Phase;
  playing: boolean;
  /**
   * Where the transport is, as a REF — the RAW anchor and the moment it landed.
   *
   * Deliberately not state: read it in an animation frame, do not render from it. Read it when
   * the number is going to be WRITTEN DOWN — a cue drop stores where the finger fell, and the
   * best estimate of that is the last thing the engine said plus however long ago it said it.
   */
  playhead: React.RefObject<Playhead>;
  /**
   * Where the transport is for DRAWING — the same position, steered so it moves evenly.
   *
   * The frames arrive every 50 ms and not on a regular beat, so extrapolating from the raw
   * anchor puts that jitter into whatever follows it: the wedge and the waveform redraw at
   * 60 fps, and two frames in three would be carrying a stale or a lurching number. This one
   * runs on local time and lets the engine bend its RATE by at most ±10%, snapping only on a
   * real seek. See `@studio/engine-browser/playhead-clock`.
   *
   * Never for a value that gets stored. It is smooth on purpose, which means it is deliberately
   * not the most accurate answer — the ±10% is the whole trade. `playhead` above is that one.
   */
  drawNow: () => number;
  engine: EngineClient | null;
  /**
   * Play this document — the desk's ONE way of putting the decks on the engine.
   *
   * A seam and not a call on `engine` above, because the two hosts disagree about who may write
   * to an engine, and only the host knows:
   *
   * | host | who writes | how |
   * |---|---|---|
   * | m9 | the browser, alone | straight out of `engine.sendProject` |
   * | l8 | the file service, alone | `POST /engine/project`, which the service forwards |
   *
   * l8's file service loads l8's project into the engine itself, so a desk sending on its own
   * socket made two writers for one engine and the last one won — a save during a set dropped
   * the decks, a deck gesture undid a save. Handing the document to the service instead leaves
   * exactly one socket and one place where the ordering rule lives.
   *
   * `engine` stays for everything that is NOT a document: the transport, a seek, a param. Those
   * are messages about what is already loaded, and neither host has a second writer for them.
   */
  sendProject: (doc: ProjectDoc) => void;
  /**
   * Reconnect. OPTIONAL, and nothing in this package reads it today — m9 returns one and the
   * card that would offer it is m9's own, outside the desk.
   *
   * Left in the type rather than deleted: it is what a host WOULD wire a "réessayer" button to,
   * and the alternative to an unread optional is a host inventing a no-op to satisfy a required
   * field, which is the worse of the two. Noted in docs/inventaire.md's terms: not dead, unread.
   */
  retry?: () => void;
  /**
   * Hear in this browser what the engine's interface is putting out. Off by default: the sound
   * is already coming out of the machine, so the tab would double it.
   *
   * OPTIONAL, and its absence means the host cannot monitor at all — l8 has no stream player.
   * The desk then draws no headphone button, rather than one that does nothing: `ui-chains`
   * made the opposite call for its `command` prop and said why — "a package that made it
   * optional would let a host ship a menu that silently does nothing". The difference is that a
   * menu with no handler is a bug, while monitoring is a capability a host may honestly lack,
   * and the honest answer to "this host cannot" is not to offer it.
   */
  listening?: boolean;
  setListening?: (on: boolean) => void;
  /** Underruns and buffer depth, once listening — the numbers étape 7 exists to expose. */
  listenStats?: { depth: number; underruns: number };
  /**
   * Every WATCHED plugin's live parameter values — the desk and the graph read the SAME one.
   *
   * They used to read nothing and their own state respectively, so moving a knob in Mix left
   * the graph drawing the value the file declared: not stale, but never true in the first
   * place. The engine is the only thing that knows what a plugin is set to, and it reports it
   * whichever surface did the setting, so one store fed from it is what keeps two pictures of
   * one plugin from disagreeing.
   *
   * An external store rather than state on purpose: while a plugin is watched the values
   * arrive as fast as they move, and a `setState` per frame would re-render the whole app to
   * turn one knob. Only what draws a value subscribes.
   */
  params: PluginParamsStore;
  /**
   * Watch exactly these plugins, and stop watching anything else.
   *
   * Called with the ids the project actually compiled, so the feed costs what the screen
   * shows. Watching is what makes the engine report a value at all — without it a knob draws
   * the file's number for ever.
   */
  watchParams: (ids: readonly string[]) => void;
  /**
   * What each `offline` module is set to — by MODULE name, since it has no plugin id.
   *
   * The tempo's other half. `deck.params` cannot carry it: the compiler emits no plugin for an
   * offline module, so the engine has nothing to report and no address to report it under. The
   * value only exists on the surface that REALISES the module — the desk, which turns it into
   * a clip warp — so the desk lends it here and the graph borrows it.
   *
   * On the Deck rather than in MixView because MixView is unmounted exactly when the graph is
   * on screen, which is the only moment the graph needs to read it.
   */
  moduleParams: Record<string, Record<string, number>>;
  /** Publish one — called by whichever surface owns the value. */
  setModuleParam: (module: string, name: string, value: number) => void;
}
