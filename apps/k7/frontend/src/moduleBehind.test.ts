import { describe, expect, it } from "vitest";
import { moduleBehind } from "./moduleBehind";

// Which file sits BESIDE an instance in the popin: its `extends` target, resolved as a ctrl-click resolves it — a whole second editor.

const hints = {
  projectRoot: "/root/song.k7",
  paths: {
    "base:audio/amp": "modules/amp/module.k7x",
    "module:eq_dj": "modules/eq_dj/module.k7x",
  },
};

describe("moduleBehind", () => {
  it("resolves the instance's extends to its module file, project root joined", () => {
    expect(moduleBehind('extends("audio/amp")\nparams({})\n', hints)).toBe(
      "/root/song.k7/modules/amp/module.k7x",
    );
    // …while another line is half-typed, too.
    expect(moduleBehind('extends("audio/amp")\nparams({\n', hints)).toBe(
      "/root/song.k7/modules/amp/module.k7x",
    );
  });

  it("falls back to the module kind — a node extending a local module by chain ref", () => {
    expect(moduleBehind('extends("eq_dj")\n', hints)).toBe(
      "/root/song.k7/modules/eq_dj/module.k7x",
    );
  });

  it("answers nothing for a base with no file — the engine's, the track bases", () => {
    expect(moduleBehind('extends("@meta/track")\n', hints)).toBeNull();
    expect(moduleBehind('extends("@meta/IN")\n', hints)).toBeNull();
  });

  it("answers nothing without an extends at all", () => {
    expect(moduleBehind('source("kick.wav")\n', hints)).toBeNull();
  });

  it("never offers the open file as its own neighbour", () => {
    expect(
      moduleBehind(
        'extends("audio/amp")\n',
        hints,
        "/root/song.k7/modules/amp/module.k7x",
      ),
    ).toBeNull();
    // …whichever path space the open file's own path is in.
    expect(
      moduleBehind('extends("audio/amp")\n', hints, "modules/amp/module.k7x"),
    ).toBeNull();
  });
});
