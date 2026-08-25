// engine.ts — the SEAM: what the desk needs from an engine, and nothing about how a host got
// one. A standalone host satisfies it with its own `useEngine` (its registry, its session, its lease); st0
// satisfies it from the link its shell already holds. Types only. See docs/hosting.md.

import type { EngineClient } from "@studio/engine-browser";
import type { ClaimTakenReason } from "@studio/engine-browser/lease";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { ProjectDoc } from "@studio/engine-protocol/project";

/** How far along the host is in getting an engine — drawn differently each way, so never a boolean. */
export type Phase =
  | { k: "looking" }
  | { k: "absent" }
  // Somebody took the claim, and this is terminal: a claim that merely lapsed is re-opened.
  | {
      k: "taken";
      heldBy: string;
      why: ClaimTakenReason;
      tookFor: string | null;
    }
  | { k: "ready"; id: string };

/** The transport's position, and the moment it was heard — see the note where it is set. */
export interface Playhead {
  seconds: number;
  /** `performance.now()` when this arrived, so a reader can extrapolate between pushes. */
  at: number;
}

/** The engine, as the desk sees it — nothing in here names a host. See docs/hosting.md. */
export interface Deck {
  phase: Phase;
  playing: boolean;
  /** The transport as a REF: the RAW anchor, for a number about to be WRITTEN DOWN (docs/hosting.md). */
  playhead: React.RefObject<Playhead>;
  /** …and the same position STEERED, for what is drawn at 60 fps — never for a value that is stored. */
  drawNow: () => number;
  /** Each PLATTER's needle by plugin id, in seconds of its record — a deck off keylock has no other clock. */
  platters: React.RefObject<Record<string, number>>;
  engine: EngineClient | null;
  /** Play this document — a seam, because who may write to an engine is the HOST's answer (docs/hosting.md). */
  sendProject: (doc: ProjectDoc) => void;
  /** Reconnect. OPTIONAL and unread here — what a host WOULD wire a "réessayer" button to. */
  retry?: () => void;
  /** Hear the engine's output in this tab — OPTIONAL, and its absence means the host cannot monitor at all. */
  listening?: boolean;
  setListening?: (on: boolean) => void;
  /** Underruns and buffer depth, once listening — the numbers étape 7 exists to expose. */
  listenStats?: { depth: number; underruns: number };
  /** Every WATCHED plugin's live values — an external store, so turning a knob re-renders no app. */
  params: PluginParamsStore;
  /** Watch exactly these plugins: without it a knob draws the file's number for ever. */
  watchParams: (ids: readonly string[]) => void;
  /** What each `offline` module is set to, by MODULE name — the desk lends, the graph borrows (docs/bpm.md). */
  moduleParams: Record<string, Record<string, number>>;
  /** Publish one — called by whichever surface owns the value. */
  setModuleParam: (module: string, name: string, value: number) => void;
}
