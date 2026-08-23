import { setModuleList } from "@studio/song-schema/yaml/moduleFile";
import { describe, expect, it } from "vitest";

// Writing an input's socket into its own file. `channel:` is spelt INLINE everywhere in this repo
// and in the docs — a two-element block sequence costs three lines to say one thing, and these are
// files people edit as text first. The rest of the file has to come back untouched, because a node
// is usually two hand-written lines and a comment saying what is plugged in.

const NODE = `# ge_rythm-in — the live guitar: interface input 2, played into the ge.rythm track.
# \`io\` and the ports come from @engine/IN; the CHANNEL is what this use adds.
extends: "@engine/IN"
channel: [ 2 ]
`;

describe("setting a live input's channel", () => {
  it("writes the list inline", () => {
    expect(setModuleList(NODE, ["channel"], [1, 2])).toContain(
      "channel: [ 1, 2 ]",
    );
  });

  it("leaves the comments, the extends and the line count alone", () => {
    const after = setModuleList(NODE, ["channel"], [5, 6]);
    expect(after).toContain("# ge_rythm-in — the live guitar");
    expect(after).toContain('extends: "@engine/IN"');
    expect(after.split("\n").length).toBe(NODE.split("\n").length);
  });

  it("adds the key to a node that names no channel yet", () => {
    const after = setModuleList('extends: "@engine/IN"\n', ["channel"], [3]);
    expect(after).toContain("channel: [ 3 ]");
    expect(after).toContain('extends: "@engine/IN"');
  });

  it("narrows a stereo input back to one channel", () => {
    expect(setModuleList(NODE, ["channel"], [2])).toContain("channel: [ 2 ]");
  });

  it("refuses an empty path rather than rewriting the document", () => {
    expect(() => setModuleList(NODE, [], [1])).toThrow();
  });
});
