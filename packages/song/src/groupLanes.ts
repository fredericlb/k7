// groupLanes.ts — a GROUP lane's file: `extends: "@meta/group-track"` and the `tracks:` it holds, written where a
// lane's file goes (`nodes/`, or `tracks/` with a chain of its own in a chain project). A member names no group of
// its own: the group's list is the one place membership is written, so moving a track is an edit of two lists.
// See docs/trackModules.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { GROUP_TRACK_REF } from "@studio/song-schema/moduleTypes";
import { TRACKS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { createChainLane } from "./chainCreate";
import { isChainProject } from "./chainProject";
import { NODES_DIR } from "./loader";
import { setFileValue } from "./yaml/edit";
import { entityFileFor } from "./yaml/moduleIO";
import { wsExists, wsWrite } from "./yaml/workspaceFile";

const LANE_NAME = /^[A-Za-z0-9_.-]+$/;

/** The group lane's text: the module it is, and the lanes it holds. */
const groupBody = (members: readonly string[]): string =>
  `extends: "${GROUP_TRACK_REF}"\ntracks: [${members.map((m) => JSON.stringify(m)).join(", ")}]\n`;

/** Write a new group lane holding `members`; it joins no `trackOrder`, since it sits above its first member. */
export function createGroupFile(
  dir: string,
  id: string,
  members: readonly string[],
): string[] {
  if (!LANE_NAME.test(id))
    throw new Error(
      `invalid group name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  if (isChainProject(dir)) return createChainLane(dir, id, groupBody(members));
  const rel = `${NODES_DIR}/${id}.yaml`;
  if (wsExists(join(dir, rel)))
    throw new Error(`a lane '${id}' already exists (${rel})`);
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  wsWrite(join(dir, rel), groupBody(members));
  return [rel];
}

/** State an existing group's members, its file found where a lane's is. */
export function setGroupMembers(
  dir: string,
  id: string,
  members: readonly string[],
): string {
  const file =
    entityFileFor(join(dir, TRACKS_DIR), TRACKS_DIR, id) ??
    entityFileFor(join(dir, NODES_DIR), NODES_DIR, id);
  if (!file) throw new Error(`no file for group '${id}'`);
  setFileValue(file.path, ["tracks"], [...members]);
  return file.rel;
}
