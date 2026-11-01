// outputRecorder.ts — the recorder a project with no timeline records its output with: the engine's own Recorder,
// placed LAST on the master run when the graph reaches OUT, never a node of the graph. Its record button is the
// project bar's. What reads wrong: a project WITH a timeline records takes on lanes and gets none. docs/outputRecording.md.

import { RECORDER_PLUGIN } from "@studio/engine-protocol/build";
import type { PluginDoc, ProjectDoc } from "@studio/engine-protocol/project";
import {
  OUT_NODE,
  OUTPUT_RECORDER_ID,
  splitPort,
} from "@studio/song-schema/moduleTypes";
import { loadGraph } from "./graph";
import { projectSurfaces } from "./surfaces";

/** The hidden recorder, as the master run's last plugin; its levels at unity, as every effect is sent them. */
const recorderPlugin = (): PluginDoc => ({
  id: OUTPUT_RECORDER_ID,
  type: RECORDER_PLUGIN,
  name: "@record",
  path: "",
  presetSave: "",
  role: "",
  enabled: true,
  params: { "@mix": 1, "@input-volume": 0, "@output-volume": 0 },
});

/** Whether `dir` records its output: no timeline surface, and some run reaching OUT. */
export function recordsOutput(dir: string): boolean {
  if (projectSurfaces(dir).surfaces.some((s) => s.surface.type === "timeline"))
    return false;
  const { chains } = loadGraph(dir);
  return Object.values(chains).some((c) =>
    c.out.some((o) => splitPort(o.to).node === OUT_NODE),
  );
}

/** `doc` with the recorder placed when `dir` records its output; unchanged otherwise. */
export function withOutputRecorder(doc: ProjectDoc, dir: string): ProjectDoc {
  if (!recordsOutput(dir)) return doc;
  return { ...doc, masterPlugins: [...doc.masterPlugins, recorderPlugin()] };
}
