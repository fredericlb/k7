// webProject.ts — a compiled ProjectDoc as the browser's WebProject: the workspace's `/project-doc`, and a share's.
// Pure, so a share builds it from a checkpoint's compile without a Workspace around it.

import { timelineLaneTrack } from "@studio/song/nodeProject";
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
    // Each timeline's lanes, drawn as a song's are when its view is open (@studio/song docs/timelines.md).
    ...(p.timelines?.length
      ? {
          timelines: p.timelines.map((t) => ({
            id: t.id,
            length: t.length,
            lanes: toWebTracks(t.lanes.map(timelineLaneTrack), p.tempo),
          })),
        }
      : {}),
  };
}
