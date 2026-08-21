// What a rendered material DECLARES — the definition `event split` and `selection consolidate`
// file beside the wav they just wrote.
//
// It states a `source:` and no window, and the nothing is the decision: `from`/`to` frame a file,
// and a render IS its file. A `to` equal to its own end would be a DURATION copied into the song,
// stale the moment `clip process` repoints `source:` at a processed wav of another length. The
// length the surfaces need is answered by the side that has the audio — see the file service's
// `naturalBeats`, and its webClipLength.test.ts.

import { AudioClipSchema } from "@studio/song/yaml/entitySchemas";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderedClipYaml } from "./materialRender";

const parsed = (text: string) => AudioClipSchema.parse(parse(text));

describe("the definition a render files", () => {
  it("names the wav it just wrote", () => {
    const text = renderedClipYaml("consolidate", "sy_260821T105129");
    expect(text).toContain("source: clips/sy_260821T105129.wav");
    expect(parsed(text).source).toBe("clips/sy_260821T105129.wav");
  });

  it("states NO window — the render is the whole of the new material", () => {
    const c = parsed(renderedClipYaml("split", "riff"));
    expect(c.from).toBeUndefined();
    expect(c.to).toBeUndefined();
  });

  it("says which verb wrote it, so a file read by hand explains itself", () => {
    expect(renderedClipYaml("split", "riff")).toContain(
      "Rendered by `event split`",
    );
    expect(renderedClipYaml("consolidate", "riff")).toContain(
      "Rendered by `event consolidate`",
    );
  });

  it("is a document the loader accepts", () => {
    // The whole of the guarantee: whatever this writes has to load, or a verb that succeeded
    // leaves a project that will not compile.
    expect(() =>
      parsed(renderedClipYaml("consolidate", "a.b_2608")),
    ).not.toThrow();
  });
});
