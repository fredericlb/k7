// engine.ts — the SEAM: what the desk needs from an engine, and nothing about how a host got
// one. m9 satisfies it with its own `useEngine` (its registry, its session, its lease); l8
// satisfies it from the link its shell already holds. Types only. See docs/hosting.md.

import type { EngineClient } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { ClaimLostReason } from "@studio/engine-browser/registry";

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
  /** `performance.now()` when this arrived, so a redraw can extrapolate between pushes. */
  at: number;
}

/**
 * The engine, as the desk sees it.
 *
 * It was m9's `useEngine` return type and is unchanged, deliberately: this extraction moved
 * the desk, not its contract. What made it a seam rather than a refactor is that nothing in
 * here names m9 — no registry, no session id, no `/m9` prefix, no lease. Those are how a host
 * OBTAINS an engine, which is exactly the part that differs between the two, and none of it
 * was in the type. See apps/m9/docs/plumbing.md for m9's half, and docs/hosting.md for what a
 * host owes this package.
 */
export interface Deck {
  phase: Phase;
  playing: boolean;
  /** Where the transport is, as a REF. Deliberately not state: read it in an animation
   *  frame, do not render from it. */
  playhead: React.RefObject<Playhead>;
  engine: EngineClient | null;
  retry: () => void;
  /** Hear in this browser what the engine's interface is putting out. Off by default: the
   *  sound is already coming out of the machine, so the tab would double it. */
  listening: boolean;
  setListening: (on: boolean) => void;
  /** Underruns and buffer depth, once listening — the numbers étape 7 exists to expose. */
  listenStats: { depth: number; underruns: number };
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
