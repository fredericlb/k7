// A module folder's `label:`, read for the file tree's row: present when the file says one, absent
// when it does not or cannot be loaded, and re-read when the file changes rather than served stale.

import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleRowLabel } from "./moduleRowLabel.ts";

const folder = (text: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "row-label-"));
  writeFileSync(join(dir, "module.yaml"), text);
  return dir;
};

describe("moduleRowLabel", () => {
  it("reads a module's label", () => {
    const dir = folder('label: "Grande salle"\nextends: "@engine/reverb"\n');
    expect(moduleRowLabel(dir, ["module.yaml"])).toBe("Grande salle");
  });

  it("is absent for a folder with no module file, a module with no label, and one that does not load", () => {
    expect(moduleRowLabel(folder("label: x\n"), ["notes.md"])).toBeUndefined();
    expect(
      moduleRowLabel(folder('extends: "@engine/reverb"\n'), ["module.yaml"]),
    ).toBeUndefined();
    expect(
      moduleRowLabel(folder("label: [unclosed\n"), ["module.yaml"]),
    ).toBeUndefined();
  });

  it("follows an edit instead of answering from the cache", () => {
    const dir = folder("label: One\n");
    expect(moduleRowLabel(dir, ["module.yaml"])).toBe("One");
    writeFileSync(join(dir, "module.yaml"), "label: Two\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, "module.yaml"), later, later);
    expect(moduleRowLabel(dir, ["module.yaml"])).toBe("Two");
  });
});
