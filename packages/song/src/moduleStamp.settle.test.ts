// The module vocabulary must never be served from before a write that could share its stamp.
//
// The stamp is a walk ending in the newest mtime among the files that define a module, and a
// rewrite landing in the same file-time tick reproduces it — the mistake `yamlCache` states one
// level down. Measured over the sequence the module builder runs (read the map to find the file,
// write it, read it back), 18 of 30 reads came back pre-write. See docs/moduleCache.md.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules, withModuleStamp } from "./loader";

let dir: string;

const modulePath = (name: string): string =>
  join(dir, "modules", "audio", name, "module.yaml");

/** Write a module, whatever it already said. */
const module_ = (name: string, body: string): void => {
  mkdirSync(join(dir, "modules", "audio", name), { recursive: true });
  writeFileSync(modulePath(name), body, "utf8");
};

/** One fixed old instant, so two backdated writes share an mtime — a fresh `Date.now()` each time
 *  would move the stamp and prove nothing about the memo. */
const OLD = new Date(Date.now() - 60_000);

/** Backdate what defines a module past the settle window, so the stamp counts as trustworthy. */
const settle = (name: string): void => {
  utimesSync(modulePath(name), OLD, OLD);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "module-settle-"));
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the module memo and a write it could not see", () => {
  // THE regression: a read, then a rewrite the stamp cannot tell from it, then a read.
  it("re-reads a module written under the stamp the last read was taken at", () => {
    // The two writes are given the SAME young mtime, which is what a same-tick rewrite is. Left to
    // the clock this would pass by luck, and a test that depends on luck proves nothing.
    const young = new Date();
    module_("amp", "plugin: { type: internal }\n");
    utimesSync(modulePath("amp"), young, young);
    expect(loadModules(dir).amp?.params).toBeUndefined();

    module_("amp", "plugin: { type: internal }\nparams:\n  Drive: 3\n");
    utimesSync(modulePath("amp"), young, young);
    expect(loadModules(dir).amp?.params).toEqual({ Drive: 3 });
  });

  it("caches a module nobody has touched for a while — the point of having a memo", () => {
    module_("amp", "plugin: { type: internal }\nparams:\n  Drive: 1\n");
    settle("amp");
    expect(loadModules(dir).amp?.params).toEqual({ Drive: 1 });
    // Changed underneath, with its mtime put back: the stamp is the same, and a memo that is
    // working answers from it. Nothing else proves the walk and the reads were skipped.
    module_("amp", "plugin: { type: internal }\nparams:\n  Drive: 9\n");
    settle("amp");
    expect(loadModules(dir).amp?.params).toEqual({ Drive: 1 });
  });

  // …and a scope still reads each thing once, which is what stops a compile re-walking after a save.
  it("holds a young read for the derivation that asked, and no longer", () => {
    module_("amp", "plugin: { type: internal }\n");
    const inside = withModuleStamp(dir, () => {
      const first = loadModules(dir);
      module_("delay", "plugin: { type: internal }\n"); // appears mid-derivation
      return { first, second: loadModules(dir) };
    });
    // One stamp, one read, one answer — the module that appeared is not in either.
    expect(Object.keys(inside.first)).not.toContain("delay");
    expect(Object.keys(inside.second)).not.toContain("delay");
    // The next derivation sees it: nothing young survived the one that could not.
    expect(Object.keys(loadModules(dir))).toContain("delay");
  });
});
