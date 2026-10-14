// shapes.ts — what each ARCHETYPE opens, in the language of the screen. Here rather than in one
// dialog because two of them offer the list now: a new workspace's first project, and a project
// added to one that exists. See ../../docs/projects.md.

import {
  PROJECT_SHAPES,
  type ProjectShape,
} from "@studio/song-schema/yaml/projectSchema";
import { m } from "../paraglide/messages.js";

/** A RECORD over `ProjectShape` and not a list: an archetype added to `PROJECT_SHAPES` and not here stops compiling. */
const WHAT: Record<ProjectShape, { label: () => string; what: () => string }> =
  {
    arrangement: {
      label: () => m["shape.arrangement"](),
      what: () => m["shape.arrangementWhat"](),
    },
    mix: { label: () => m["shape.mix"](), what: () => m["shape.mixWhat"]() },
    video: {
      label: () => m["shape.video"](),
      what: () => m["shape.videoWhat"](),
    },
    live: { label: () => m["shape.live"](), what: () => m["shape.liveWhat"]() },
    "live-video": {
      label: () => m["shape.liveVideo"](),
      what: () => m["shape.liveVideoWhat"](),
    },
  };

/** …in the order the vocabulary declares them, which is the order they are offered in. */
export const SHAPES: {
  id: ProjectShape;
  label: () => string;
  what: () => string;
}[] = PROJECT_SHAPES.map((id) => ({ id, ...WHAT[id] }));
