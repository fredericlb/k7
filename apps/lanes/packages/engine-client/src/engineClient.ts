// engineClient.ts — the full engine link: everything in EngineControl plus sendProject,
// which needs @lanes/song (the compiler + Strudel, ~3 MB). Surfaces that only ask the
// engine questions import engineControl instead and carry none of it — so a new method
// belongs there unless it genuinely needs a project doc. This file should stay this short.

import {
  type ProjectDoc,
  withGroupMix,
  withoutVideo,
} from "@lanes/song/project";
import { EngineControl } from "./engineControl";

// Re-exported so `@lanes/engine-client/engineClient` importers keep resolving what they used to get here.
export type {
  AudioDeviceInfo,
  EditPluginInfo,
  EngineState,
  PluginInfo,
  RecordedTake,
  TransportAction,
} from "./engineControl";
export { EngineControl } from "./engineControl";

export class EngineClient extends EngineControl {
  // The doc is folded to what the engine plays at this one choke point: withGroupMix resolves groups onto their
  // members (the engine has no grouping) and withoutVideo drops the picture. Contracts stated, not crashes
  // prevented — the engine ignores unknown keys either way. Ordering with flush() holds: one socket, one outbox.
  sendProject(doc: ProjectDoc): void {
    this.send({ type: "project", doc: withoutVideo(withGroupMix(doc)) });
  }
}
