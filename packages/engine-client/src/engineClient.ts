// engineClient.ts — the full engine link: everything in EngineControl plus sendProject,
// which needs @studio/song (the compiler + Strudel, ~3 MB). Surfaces that only ask the
// engine questions import engineControl instead and carry none of it — so a new method
// belongs there unless it genuinely needs a project doc. This file should stay this short.

import { type ProjectDoc, withGroupMix } from "@studio/song/project";
import { EngineControl } from "./engineControl";

// Re-exported so an importer of `@studio/engine-client/engineClient` gets the control types too, without a second import.
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
  // Folded to what the engine plays at this one choke point: groups resolved onto their members.
  sendProject(doc: ProjectDoc): void {
    this.send({ type: "project", doc: withGroupMix(doc) });
  }
}
