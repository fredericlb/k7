// shapes.ts — what each ARCHETYPE opens, in the language of the screen. Here rather than in one
// dialog because two of them offer the list now: a new workspace's first project, and a project
// added to one that exists. See ../../docs/projects.md.

import {
  PROJECT_SHAPES,
  type ProjectShape,
} from "@studio/song-schema/yaml/projectSchema";

/** Un RECORD sur `ProjectShape` et pas une liste : un archétype ajouté à `PROJECT_SHAPES` et pas ici ne compile plus. */
const WHAT: Record<ProjectShape, { label: string; what: string }> = {
  arrangement: {
    label: "arrangement",
    what: "la timeline au-dessus du graphe — une piste, un synthé, un motif",
  },
  mix: {
    label: "mix",
    what: "deux platines, un crossfade, et une liste de morceaux vide",
  },
  video: {
    label: "vidéo",
    what: "la timeline et le viewport — l'arrangement, plus une piste d'image",
  },
  live: {
    label: "live",
    what: "aucune surface — une entrée, un fader, la sortie",
  },
  "live-video": {
    label: "live vidéo",
    what: "le même rig, plus une webcam et le viewport qu'elle remplit",
  },
};

/** …dans l'ordre où le vocabulaire les déclare, qui est l'ordre où on les propose. */
export const SHAPES: { id: ProjectShape; label: string; what: string }[] =
  PROJECT_SHAPES.map((id) => ({ id, ...WHAT[id] }));
