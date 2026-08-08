// faces.ts — which modules the library already holds a FACE for: the `extends` of every
// module.yaml under `modules/`. Read on demand, never catalogued: it answers one question, for
// the one caller that fills the library from a machine's plugin scan.
// See `@studio/song`'s engineFace.ts and docs/moduleNamespaces.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { mediatekDir } from "./layout.ts";
import { MODULE_FILE, scanFamily } from "./scan.ts";

/**
 * Every ref a module in this library extends, deduplicated.
 *
 * Its own walk rather than a field on `MediatekEntry`, deliberately: the scan does not open a
 * module.yaml today — it only checks that one is there — and making it parse every module on
 * every rescan would put a cost on the listing that draws the tree, to answer a question asked
 * when somebody clicks one menu item.
 *
 * A module that will not parse contributes nothing rather than throwing. It is the same
 * tolerance the scan itself keeps: this reads a folder people edit by hand, and a library that
 * refused to answer because one file has a stray tab is worse than one that answers short.
 */
export function extendedRefs(): Set<string> {
  const out = new Set<string>();
  const root = mediatekDir();
  for (const e of scanFamily("modules")) {
    try {
      const doc = parseYaml(
        readFileSync(join(root, e.path, MODULE_FILE), "utf8"),
        { version: "1.2" },
      );
      const ref = (doc as { extends?: unknown } | null)?.extends;
      if (typeof ref === "string" && ref.trim()) out.add(ref.trim());
    } catch {
      /* unreadable, or not a mapping — it faces nothing this can name */
    }
  }
  return out;
}
