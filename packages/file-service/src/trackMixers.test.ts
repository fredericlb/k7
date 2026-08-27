// Which node is a lane's fader. It cannot be read off `graph.yaml`: that file says what a module is
// WIRED to, never what plugin it turns out to be, and a strip is defined by its type. So it comes in
// from the compiled project, exactly as the clip extents do.

import { MIXER_PLUGIN } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { trackMixersOf } from "./graphDoc";

const track = (id: string, plugins: [string, string][]) => ({
  id,
  plugins: plugins.map(([type, name]) => ({ type, name })),
});

describe("trackMixersOf", () => {
  it("names the mixer of each lane that has one", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [
            ["Reverb", "verb"],
            [MIXER_PLUGIN, "strip"],
          ]),
        ],
      }),
    ).toEqual({ gt: "strip" });
  });

  it("leaves out a lane with no strip — absent means NO fader, not one at unity", () => {
    expect(
      trackMixersOf({ tracks: [track("gt", [["Reverb", "verb"]])] }),
    ).toEqual({});
  });

  it("takes the LAST one, where the level lives", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [
            [MIXER_PLUGIN, "pre"],
            ["Reverb", "verb"],
            [MIXER_PLUGIN, "post"],
          ]),
        ],
      }),
    ).toEqual({ gt: "post" });
  });

  it("answers per lane, and says nothing for a project with none", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [[MIXER_PLUGIN, "a"]]),
          track("dr", [[MIXER_PLUGIN, "b"]]),
        ],
      }),
    ).toEqual({ gt: "a", dr: "b" });
    expect(trackMixersOf({ tracks: [] })).toEqual({});
  });
});
