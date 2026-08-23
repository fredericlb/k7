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
  // Folded to what the engine plays at this one choke point: groups resolved onto their members, and takes dropped.
  sendProject(doc: ProjectDoc): void {
    this.send({ type: "project", doc: withoutTakes(withGroupMix(doc)) });
  }

  /** REPLACE these tracks in the document the engine holds; it takes the WHOLE doc so the delta is a piece of what a full send would produce. */
  sendTracks(doc: ProjectDoc, ids: readonly string[]): void {
    const want = new Set(ids);
    const tracks = withoutTakes(withGroupMix(doc)).tracks.filter((t) =>
      want.has(t.id),
    );
    if (tracks.length) this.send({ type: "tracks", tracks });
  }
}
