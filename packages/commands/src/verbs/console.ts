// console.ts — `project console`: which summing CONSOLE runs over the whole mix, written to
// `project.console`. A system is named whole, never its two halves, so they cannot be mismatched;
// `none` takes the key out. Always a reload, since every lane gains or loses a plugin.
// See packages/song/docs/console.md.

import { join } from "node:path";
import { consoleSystems } from "@studio/song/console";
import { loadModuleRefs } from "@studio/song/loader";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const CONSOLE_VERBS: Record<string, SidHandler> = {
  "project.console": async (a, h) => {
    const [want] = splitWords(a);
    const systems = consoleSystems(loadModuleRefs(h.songPath));
    if (!want) {
      // The list is the useful answer to "which ones are there?", so a bare call says it.
      h.log(
        systems.length
          ? systems.map((s) => `${s.ref}  ${s.label}`)
          : [
              "no console in this account's libraries — a system is a library's console/<name>/ with channel/ and buss/",
            ],
      );
      return;
    }
    const file = join(h.songPath, "project.k7x");
    if (want === "none") {
      deleteFileValue(file, ["project", "console"]);
      h.log(["console: none — the lanes sum as they are"]);
      await h.reload();
      return;
    }
    if (!systems.some((s) => s.ref === want))
      return h.refuse([
        `no console '${want}'${systems.length ? ` — there are ${systems.map((s) => s.ref).join(", ")}` : ""}`,
      ]);
    setFileValue(file, ["project", "console"], want);
    h.log([
      `console: ${want} — a channel after every strip, the buss first on the master`,
    ]);
    await h.reload();
  },
};
