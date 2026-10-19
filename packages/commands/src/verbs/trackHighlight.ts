// trackHighlight.ts — `track highlight <track>`: the mixer's highlight button. The lane joins or leaves
// `highlighted:` at project.k7x's root, and the compile plays it 10 dB up on its strip's output stage,
// its fader untouched — so switching it off returns the mix exactly as it was. Several at once, like
// solo. See packages/song/docs/highlight.md.

import { join } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const TRACK_HIGHLIGHT_VERBS: Record<string, SidHandler> = {
  "track.highlight": highlightCommand,
};

async function highlightCommand(a: string, h: CommandHost): Promise<void> {
  const [arg] = splitWords(a);
  if (!arg) {
    h.refuse(["usage: track highlight <track>"]);
    return;
  }
  const track = h.project().tracks.find((t) => t.id === arg || t.name === arg);
  if (!track) {
    h.refuse([`no track "${arg}"`]);
    return;
  }
  // The LANE, as `soloed:` names it: a lane split into an audio and a MIDI half is one entry.
  const lane = track.id.split("#")[0];
  try {
    const cur = (loadProjectRoot(h.songPath).highlighted ?? []).map(String);
    const on = !cur.includes(lane);
    const next = on ? [...cur, lane] : cur.filter((x) => x !== lane);
    const file = join(h.songPath, "project.k7x");
    if (next.length) setFileValue(file, ["highlighted"], next);
    else deleteFileValue(file, ["highlighted"]);
    h.log([`${lane}: highlight ${on ? "on — 10 dB up" : "off"}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`track highlight failed: ${(e as Error).message}`]);
  }
}
