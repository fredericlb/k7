// trackGroup.ts — `track group <tracks> [name]`: a new GROUP lane holding those tracks, what the timeline's
// right-click offers once several lanes are picked. A track already in a group LEAVES it, since a track sits in
// one group at most. The tracks come first so a menu can fill them and run it. See docs/verbs.md.

import { createGroupFile, setGroupMembers } from "@studio/song/groupLanes";
import { splitPort } from "@studio/song-schema/moduleTypes";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

/** The next free `group-<n>` among the song's lanes and groups. */
function freeGroupName(h: CommandHost): string {
  const p = h.project();
  const taken = new Set([
    ...p.tracks.map((t) => splitPort(t.id).node),
    ...(p.groups ?? []).map((g) => g.id),
  ]);
  let n = 1;
  while (taken.has(`group-${n}`)) n++;
  return `group-${n}`;
}

async function group(a: string, h: CommandHost): Promise<void> {
  const [list, name] = splitWords(a);
  if (!list)
    return h.refuse(["usage: track group <tracks, comma-joined> [name]"]);
  const p = h.project();
  const groups = new Set((p.groups ?? []).map((g) => g.id));
  const members: string[] = [];
  for (const want of list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (groups.has(want))
      return h.refuse([
        `'${want}' is a group — a group holds tracks, not groups`,
      ]);
    const t = p.tracks.find(
      (x) => x.id === want || x.name === want || splitPort(x.id).node === want,
    );
    if (!t) return h.refuse([`no track '${want}'`]);
    const lane = splitPort(t.id).node;
    if (!members.includes(lane)) members.push(lane);
  }
  const id = name || freeGroupName(h);
  try {
    // Out of the groups they were in first: the warning "in two groups" is a state no command should leave.
    const left = new Map<string, string[]>();
    for (const t of p.tracks)
      if (t.group && !t.generated) {
        const lane = splitPort(t.id).node;
        const rest = left.get(t.group) ?? [];
        if (!members.includes(lane) && !rest.includes(lane)) rest.push(lane);
        left.set(t.group, rest);
      }
    const touched = new Set(
      p.tracks
        .filter((t) => t.group && members.includes(splitPort(t.id).node))
        .map((t) => t.group),
    );
    const edited = [...touched].map((g) =>
      setGroupMembers(h.songPath, g, left.get(g) ?? []),
    );
    const written = createGroupFile(h.songPath, id, members);
    await h.reload();
    h.log([
      `+ group ${id}: ${members.join(", ")} (${written.join(", ")})`,
      ...(edited.length
        ? [`  out of ${[...touched].join(", ")} (${edited.join(", ")})`]
        : []),
    ]);
  } catch (e) {
    h.refuse([`track group: ${(e as Error).message}`]);
  }
}

export const TRACK_GROUP_VERBS: Record<string, SidHandler> = {
  "track.group": (a, h) => group(a, h),
};
