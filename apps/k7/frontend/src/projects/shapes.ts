// shapes.ts — what each ARCHETYPE opens, in the language of the screen. Here rather than in one
// dialog because two of them offer the list now: a new workspace's first project, and a project
// added to one that exists. See ../../docs/projects.md.

import {
  ChartGantt,
  Clapperboard,
  Disc3,
  type LucideIcon,
  SlidersVertical,
  Webcam,
} from "@frediverse/ui/icons";
import {
  PROJECT_SHAPES,
  type ProjectShape,
} from "@studio/song-schema/projectShapes";
import { m } from "../paraglide/messages.js";

interface ShapeWords {
  label: () => string;
  what: () => string;
  /** The glyph a home-page row and the picker both draw for it. */
  icon: LucideIcon;
}

/** A RECORD over `ProjectShape` and not a list: an archetype added to `PROJECT_SHAPES` and not here stops compiling. */
const WHAT: Record<ProjectShape, ShapeWords> = {
  arrangement: {
    label: () => m["shape.arrangement"](),
    what: () => m["shape.arrangementWhat"](),
    icon: ChartGantt,
  },
  mix: {
    label: () => m["shape.mix"](),
    what: () => m["shape.mixWhat"](),
    icon: Disc3,
  },
  video: {
    label: () => m["shape.video"](),
    what: () => m["shape.videoWhat"](),
    icon: Clapperboard,
  },
  live: {
    label: () => m["shape.live"](),
    what: () => m["shape.liveWhat"](),
    icon: SlidersVertical,
  },
  "live-video": {
    label: () => m["shape.liveVideo"](),
    what: () => m["shape.liveVideoWhat"](),
    icon: Webcam,
  },
};

/** …in the order the vocabulary declares them, which is the order they are offered in. */
export const SHAPES: (ShapeWords & { id: ProjectShape })[] = PROJECT_SHAPES.map(
  (id) => ({ id, ...WHAT[id] }),
);

/** One archetype's words and glyph, for a row that knows which one it is. */
export const shapeWords = (shape: ProjectShape): ShapeWords => WHAT[shape];
