// webProject.ts — a compiled ProjectDoc as the browser's WebProject: the workspace's `/project-doc`, and a share's.
// Pure, so a share builds it from a checkpoint's compile without a Workspace around it.

import type { ProjectDoc } from "@studio/song/project";
import type { WebProject } from "@studio/web-protocol";
import { toWebTracks } from "./webTracks.ts";

export function webProjectOf(p: ProjectDoc): WebProject {
  return {
    name: p.name,
    tempo: p.tempo,
    timeSigNumerator: p.timeSigNumerator,
    timeSigDenominator: p.timeSigDenominator,
    tracks: toWebTracks(p.tracks, p.tempo),
    groups: p.groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      mute: g.mute,
      solo: g.solo,
    })),
    masterVolume: p.masterVolume,
    metronome: p.settings.metronome,
    metronomeLevel: p.settings.metronomeLevel,
    countIn: p.settings.countIn,
    markers: p.markers.map((m) => ({ beat: m.beat, name: m.name, tc: m.tc })),
  };
}
