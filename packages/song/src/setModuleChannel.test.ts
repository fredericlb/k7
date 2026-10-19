import { K7Document } from "@studio/k7x/document";
import { setModuleList } from "@studio/song-schema/yaml/moduleFile";
import { describe, expect, it } from "vitest";

// `channel` is spelt INLINE, and the rest of a hand-written node file has to come back untouched.

const NODE = `// ge_rythm-in — the live guitar: interface input 2, played into the ge.rythm track.
// \`io\` and the ports come from @meta/IN; the CHANNEL is what this use adds.
extends("@meta/IN")
channel([2])
`;

const set = (text: string, path: string[], values: number[]): string => {
  const doc = new K7Document(text);
  setModuleList(doc.at([]), path, values);
  return doc.toString();
};

describe("setting a live input's channel", () => {
  it("writes the list inline", () => {
    expect(set(NODE, ["channel"], [1, 2])).toContain("channel([1, 2])");
  });

  it("leaves the comments, the extends and the line count alone", () => {
    const after = set(NODE, ["channel"], [5, 6]);
    expect(after).toContain("// ge_rythm-in — the live guitar");
    expect(after).toContain('extends("@meta/IN")');
    expect(after.split("\n").length).toBe(NODE.split("\n").length);
  });

  it("adds the key to a node that names no channel yet", () => {
    const after = set('extends("@meta/IN")\n', ["channel"], [3]);
    expect(new K7Document(after).toJS()).toEqual({
      extends: "@meta/IN",
      channel: [3],
    });
    expect(after.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("narrows a stereo input back to one channel", () => {
    expect(set(NODE, ["channel"], [2])).toBe(NODE);
  });

  it("refuses an empty path rather than rewriting the document", () => {
    expect(() => set(NODE, [], [1])).toThrow();
  });
});
