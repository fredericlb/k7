// A transition module's GLSL: that it sits LOOSE in the module folder, that the ancestry is
// walked, and the two refusals shaders.test.ts also pins — half a program is not one, and a name
// that climbs out is not read. Plus `readFade`, where the scalar spelling is undone.
// See docs/transitions.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VideoTrackDoc } from "./videoDoc";
import { readFade } from "./videoTracks";
import {
  collectTransitions,
  readTransition,
  transitionChoices,
} from "./videoTransitions";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "transitions-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A transition module folder: the two stages sit BESIDE module.yaml, not under a `shaders/<name>/`. */
function transitionModule(
  folder: string,
  stages: "both" | "fragment-only" | "none",
): string {
  const abs = join(root, folder);
  mkdirSync(abs, { recursive: true });
  if (stages === "none") return abs;
  writeFileSync(join(abs, "fragment.glsl"), `// ${folder} frag\n`);
  if (stages === "both")
    writeFileSync(join(abs, "vertex.glsl"), `// ${folder} vert\n`);
  return abs;
}

const ref = (name: string, m: Record<string, unknown>) => ({
  [`video_transitions/${name}`]: m,
});

describe("readTransition", () => {
  it("reads the two stages from the module's OWN folder", () => {
    const folderAbs = transitionModule("wipe", "both");
    const got = readTransition(root, "wipe", ref("wipe", { folderAbs }));
    expect(got?.name).toBe("wipe");
    expect(got?.vertex).toContain("wipe vert");
    expect(got?.fragment).toContain("wipe frag");
  });

  it("skips a folder missing a stage — half a program is not a transition", () => {
    const folderAbs = transitionModule("wipe", "fragment-only");
    expect(readTransition(root, "wipe", ref("wipe", { folderAbs }))).toBeNull();
  });

  it("walks the ancestry, so a thin local module reaches a shared one's GLSL", () => {
    const parent = transitionModule("shared-wipe", "both");
    const folderAbs = transitionModule("wipe", "none");
    const refs = {
      ...ref("wipe", { folderAbs, extends: "@st0/video_transitions/wipe" }),
      "@st0/video_transitions/wipe": { folderAbs: parent },
    };
    expect(readTransition(root, "wipe", refs)?.vertex).toContain(
      "shared-wipe vert",
    );
  });

  it("prefers the NEAREST owner, so a local program masks an inherited one", () => {
    const parent = transitionModule("shared-wipe", "both");
    const folderAbs = transitionModule("wipe", "both");
    const refs = {
      ...ref("wipe", { folderAbs, extends: "@st0/video_transitions/wipe" }),
      "@st0/video_transitions/wipe": { folderAbs: parent },
    };
    expect(readTransition(root, "wipe", refs)?.vertex).toContain("wipe vert");
  });

  it("refuses a name that climbs out, before any path is built", () => {
    transitionModule("wipe", "both");
    expect(readTransition(root, "../../etc", {})).toBeNull();
  });

  it("is null for a name no module answers to", () => {
    expect(readTransition(root, "nope", {})).toBeNull();
  });

  it("clamps the four knobs to 0..1, the value leaving TypeScript for GLSL", () => {
    const folderAbs = transitionModule("wipe", "both");
    const refs = ref("wipe", { folderAbs, params: { P1: 4, P2: -1, P3: 0.5 } });
    expect(readTransition(root, "wipe", refs)?.params).toEqual({
      P1: 1,
      P2: 0,
      P3: 0.5,
      P4: 0,
    });
  });
});

/** A lane holding one clip with the given fades — only the fields collectTransitions reads. */
const lane = (fades: Partial<VideoTrackDoc["clips"][number]>): VideoTrackDoc =>
  ({
    id: "main",
    clips: [
      {
        id: "a",
        name: "a",
        source: "",
        start: 0,
        length: 1,
        sourceFrom: 0,
        ...fades,
      },
    ],
  }) as VideoTrackDoc;

describe("collectTransitions", () => {
  it("reads each NAMED kind once, however many cuts use it", () => {
    const folderAbs = transitionModule("wipe", "both");
    const refs = ref("wipe", { folderAbs });
    const got = collectTransitions(
      root,
      [
        lane({ fadeIn: { over: 1, with: "wipe" } }),
        lane({ fadeOut: { over: 2, with: "wipe" } }),
      ],
      refs,
    );
    expect(Object.keys(got)).toEqual(["wipe"]);
  });

  it("leaves the built-in dissolve OUT — the renderer owns that one", () => {
    const got = collectTransitions(
      root,
      [lane({ fadeIn: { over: 1, with: "dissolve" } })],
      {},
    );
    expect(got).toEqual({});
  });

  it("lets a module on disk OVERRIDE the built-in dissolve", () => {
    const folderAbs = transitionModule("dissolve", "both");
    const got = collectTransitions(
      root,
      [lane({ fadeIn: { over: 1, with: "dissolve" } })],
      ref("dissolve", { folderAbs }),
    );
    expect(got.dissolve?.vertex).toContain("dissolve vert");
  });

  it("drops a name nothing answers to rather than throwing", () => {
    expect(
      collectTransitions(
        root,
        [lane({ fadeIn: { over: 1, with: "gone" } })],
        {},
      ),
    ).toEqual({});
  });
});

describe("transitionChoices", () => {
  it("offers only the modules that hold both stages", () => {
    const ok = transitionModule("wipe", "both");
    const half = transitionModule("push", "fragment-only");
    expect(
      transitionChoices(root, {
        ...ref("wipe", { folderAbs: ok }),
        ...ref("push", { folderAbs: half }),
      }),
    ).toEqual(["wipe"]);
  });
});

describe("readFade", () => {
  it("reads a bare number as the built-in dissolve", () => {
    expect(readFade(1.5)).toEqual({ over: 1.5, with: "dissolve" });
  });

  it("reads the map form, keeping the named kind", () => {
    expect(readFade({ over: 2, with: "wipe" })).toEqual({
      over: 2,
      with: "wipe",
    });
  });

  it("defaults a map with no `with` to the dissolve", () => {
    expect(readFade({ over: 2 })).toEqual({ over: 2, with: "dissolve" });
  });

  it("is absent for zero, absent and nonsense — a zero-length fade is a cut", () => {
    expect(readFade(0)).toBeUndefined();
    expect(readFade(undefined)).toBeUndefined();
    expect(readFade({ over: 0, with: "wipe" })).toBeUndefined();
    expect(readFade("1")).toBeUndefined();
  });
});
