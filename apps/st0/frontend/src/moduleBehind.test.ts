import { describe, expect, it } from "vitest";
import { moduleBehind } from "./moduleBehind";

// Which file sits BESIDE an instance in the popin: its `extends:` target, resolved as a ctrl-click resolves it — a whole second editor.

const hints = {
  projectRoot: "/root/song.st0",
  paths: {
    "base:audio/amp": "modules/amp/module.yaml",
    "module:eq_dj": "modules/eq_dj/module.yaml",
  },
};

describe("moduleBehind", () => {
  it("resolves the instance's extends to its module file, project root joined", () => {
    expect(moduleBehind("extends: audio/amp\nparams: {}\n", hints)).toBe(
      "/root/song.st0/modules/amp/module.yaml",
    );
    // Quoted, as nearly every real file spells it.
    expect(moduleBehind('extends: "audio/amp"\n', hints)).toBe(
      "/root/song.st0/modules/amp/module.yaml",
    );
  });

  it("falls back to the module kind — a node extending a local module by chain ref", () => {
    expect(moduleBehind("extends: eq_dj\n", hints)).toBe(
      "/root/song.st0/modules/eq_dj/module.yaml",
    );
  });

  it("answers nothing for a base with no file — the engine's, the track bases", () => {
    expect(moduleBehind('extends: "@studio/track"\n', hints)).toBeNull();
    expect(moduleBehind('extends: "@engine/IN"\n', hints)).toBeNull();
  });

  it("answers nothing without an extends at all", () => {
    expect(moduleBehind("source: kick.wav\n", hints)).toBeNull();
  });

  it("never offers the open file as its own neighbour", () => {
    expect(
      moduleBehind(
        "extends: audio/amp\n",
        hints,
        "/root/song.st0/modules/amp/module.yaml",
      ),
    ).toBeNull();
    // …whichever path space the open file's own path is in.
    expect(
      moduleBehind("extends: audio/amp\n", hints, "modules/amp/module.yaml"),
    ).toBeNull();
  });
});
