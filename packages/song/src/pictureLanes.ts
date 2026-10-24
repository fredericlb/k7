// pictureLanes.ts — which of a project's lanes are PICTURE lanes, and where one's file is: what
// every `picture …` verb and completion asks before it edits a shot. A picture lane is a lane
// node like any other, told apart by what it resolves to (docs/trackModules.md).

import { laneFileFor } from "./chainItemEdit";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import { pictureLanesOf } from "./trackModule";
import type { ModuleFile } from "./yaml/moduleIO";

/** The project's picture lanes, by node name, in the module map's order. */
export function pictureLaneIds(dir: string): string[] {
  return Object.keys(
    pictureLanesOf(resolveModuleMap(loadModules(dir), loadModuleRefs(dir))),
  );
}

/** Picture lane `lane`'s own file, or null when the project has no picture lane of that name. */
export function pictureLaneFile(dir: string, lane: string): ModuleFile | null {
  return pictureLaneIds(dir).includes(lane) ? laneFileFor(dir, lane) : null;
}
