// engineClient.ts — the full engine link: everything in EngineControl plus sendProject,
// which needs @studio/song (the compiler + Strudel, ~3 MB). Surfaces that only ask the
// engine questions import engineControl instead and carry none of it — so a new method
// belongs there unless it genuinely needs a project doc. This file should stay this short.

import {
  type ProjectDoc,
  withGroupMix,
  withoutTakes,
} from "@studio/song/project";
import { EngineControl } from "./engineControl";

// Re-exported so `@studio/engine-client/engineClient` importers keep resolving what they used to get here.
export type {
  AudioDeviceInfo,
  EditPluginInfo,
  EngineState,
  PluginInfo,
  PluginParamInfo,
  RecordedTake,
  TransportAction,
} from "./engineControl";
export { EngineControl } from "./engineControl";

export class EngineClient extends EngineControl {
  // The doc is folded to what the engine plays at this one choke point: withGroupMix resolves groups onto their
  // members, which the engine has no notion of, and withoutTakes drops what a lane WAS playing —
  // material for a surface to draw, never for the engine to diff. Nothing strips picture here: a
  // ProjectDoc carries none. Ordering with flush() holds: one socket, one outbox.
  sendProject(doc: ProjectDoc): void {
    this.send({ type: "project", doc: withoutTakes(withGroupMix(doc)) });
  }

  /**
   * Replace just these tracks in the document the engine already holds.
   *
   * For the pattern clock, which rewrites a handful of lanes' clips six or seven times a second
   * while the rest of the song sits still: 137 KB of document became 3.7 KB of tracks on a real
   * project, and the engine stopped rebuilding its whole diff baseline to notice eight notes.
   *
   * It takes the WHOLE doc and the ids to send, deliberately, rather than the tracks alone. The
   * fold above is what the engine plays — groups resolved onto their members, takes dropped —
   * and folding a loose array could not do the group half at all. Folding the doc and then
   * projecting means the delta is by construction a piece of the document a full send would have
   * produced, which is the property that lets the engine merge it without thinking.
   *
   * REPLACES, never adds or removes: an id the engine does not hold is a disagreement, and it
   * says so rather than growing a track nobody asked for. The caller is responsible for sending
   * a whole document whenever the set of tracks changes — see PatternClock.emit.
   */
  sendTracks(doc: ProjectDoc, ids: readonly string[]): void {
    const want = new Set(ids);
    const tracks = withoutTakes(withGroupMix(doc)).tracks.filter((t) =>
      want.has(t.id),
    );
    if (tracks.length) this.send({ type: "tracks", tracks });
  }
}
