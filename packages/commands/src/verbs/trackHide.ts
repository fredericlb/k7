// trackHide.ts — `track hide` / `track unhide`: `hidden: true` on the lane's chain sets the whole chain
// aside — no timeline row, no graph card, nothing compiled or played — and its files stay as written.
// The one thing a reader would get wrong: a hidden lane is also taken out of `soloed`, since a solo
// nobody can see would silence every other lane. See packages/song/docs/chainFiles.md, "Hidden chains".

import { relative } from "node:path";
import {
  chainFilePath,
  isChainProject,
  readChainProject,
} from "@studio/song/chainProject";
import { loadProjectRoot } from "@studio/song/loader";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { splitPort } from "@studio/song-schema/moduleTypes";
import {
  type ChainFile,
  isTrackItem,
  itemsOf,
  stepLists,
} from "@studio/song-schema/yaml/chainSchema";
import type { CommandHost, SidHandler } from "../commands.ts";

export const TRACK_HIDE_VERBS: Record<string, SidHandler> = {
  "track.hide": (a, h) => hideTrack(a, h, true),
  "track.unhide": (a, h) => hideTrack(a, h, false),
};

async function hideTrack(
  arg: string,
  h: CommandHost,
  hide: boolean,
): Promise<void> {
  const verb = hide ? "track hide" : "track unhide";
  const idArg = arg.trim().split(/\s+/).filter(Boolean)[0];
  if (!idArg) {
    h.refuse([`usage: ${verb} <track>`]);
    return;
  }
  const dir = h.songPath;
  if (!isChainProject(dir)) {
    h.refuse([
      `${verb}: a track is hidden by its chain, and only a chain project has chain files`,
    ]);
    return;
  }
  const lane = splitPort(idArg).node;
  const cp = readChainProject(dir);
  const holds = (c: ChainFile): boolean =>
    stepLists(c).some((l) =>
      l.steps.some((s) =>
        itemsOf(s).some((i) => isTrackItem(i) && i.track === lane),
      ),
    );
  // The chain holding the lane: among the shown chains to hide it, among the hidden ones to bring it back.
  const chain = Object.entries(hide ? cp.chains : (cp.hidden ?? {})).find(
    ([, c]) => holds(c),
  )?.[0];
  if (!chain) {
    const elsewhere = Object.values((hide ? cp.hidden : cp.chains) ?? {}).some(
      holds,
    );
    h.refuse([
      elsewhere
        ? `"${lane}" is already ${hide ? "hidden" : "shown"}`
        : `no track "${idArg}" in this project`,
    ]);
    return;
  }
  try {
    const path = chainFilePath(dir, chain);
    if (hide) setFileValue(path, ["hidden"], true);
    else deleteFileValue(path, ["hidden"]);
    const notes = [relative(dir, path)];
    if (hide) {
      const soloed = (loadProjectRoot(dir).soloed ?? []).map(String);
      const project = entityFileFor(dir, "", "project");
      if (project && soloed.includes(lane)) {
        const next = soloed.filter((x) => x !== lane);
        if (next.length) setFileValue(project.path, ["soloed"], next);
        else deleteFileValue(project.path, ["soloed"]);
        notes.push(`unsoloed in ${project.rel.replace(/^\//, "")}`);
      }
    }
    await h.reload();
    h.log([
      hide
        ? `${lane} hidden (${notes.join(", ")}) — \`track unhide ${lane}\` brings it back`
        : `${lane} shown again (${notes.join(", ")})`,
    ]);
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}
