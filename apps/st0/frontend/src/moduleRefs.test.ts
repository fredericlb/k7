import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { mediatekModuleRefs } from "./moduleRefs";

const entry = (path: string, catalogued = true): MediatekEntry =>
  ({
    family: "modules",
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    kind: path.split("/")[1] ?? "",
    mtime: 0,
    meta: { catalogued },
  }) as MediatekEntry;

describe("mediatekModuleRefs", () => {
  it("names a module the way a chain node does", () => {
    // Measured against the library on this machine: a node beside a template says
    // `extends: "@st0/audio/distortion/bitcrush"` for the folder of that path.
    expect(
      mediatekModuleRefs([
        entry("modules/audio/distortion/bitcrush"),
        entry("modules/audio/utility/mixer"),
      ]),
    ).toEqual(["@st0/audio/distortion/bitcrush", "@st0/audio/utility/mixer"]);
  });

  it("drops a folder that carries no module file", () => {
    // The tree draws one — `scanUnlisted` reports what no entry accounts for — but nothing
    // can extend it, and completing to a ref that resolves to nothing is worse than silence.
    expect(mediatekModuleRefs([entry("modules/audio/empty", false)])).toEqual(
      [],
    );
  });

  it("ignores anything that is not under `modules/`", () => {
    // The namespace REPLACES that segment, so a path without it has no ref to make.
    expect(mediatekModuleRefs([entry("songs/AC-DC/Back in Black")])).toEqual(
      [],
    );
  });
});
