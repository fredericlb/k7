// The cold pass decides and refuses; it does not run a model. So what is pinned is the
// deciding and the refusing — and in particular that the two ways an offline step can be
// unrunnable produce DIFFERENT sentences, because only one of them is fixed by downloading
// something.

import { join } from "node:path";
import type { loadModuleRefs } from "@studio/song/loader";
import { describe, expect, it } from "vitest";

type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

import {
  coldOutDir,
  coldStepOf,
  isOfflineModule,
  runColdPasses,
  STEMS_DIR,
} from "./coldPass";

const mod = (over: Partial<LoadedModule> = {}) =>
  ({
    plugin: { type: "offline", name: "Stem Split" },
    assets: { onnx: "htdemucs.onnx" },
    onnx: "/models/htdemucs.onnx",
    ...over,
  }) as LoadedModule;

describe("which steps are cold", () => {
  it("is decided by the plugin type, whatever its case", () => {
    expect(isOfflineModule(mod())).toBe(true);
    expect(isOfflineModule({ plugin: { type: "OFFLINE" } })).toBe(true);
  });

  it("leaves every ordinary module alone", () => {
    // jsdsp is the one worth naming: it is also authored rather than scanned.
    expect(isOfflineModule({ plugin: { type: "jsdsp" } })).toBe(false);
    expect(isOfflineModule({ plugin: { type: "vst3" } })).toBe(false);
    expect(isOfflineModule({})).toBe(false);
  });
});

describe("what it refuses, before anything is rendered", () => {
  it("names an offline module that declares no model as authored wrong", () => {
    expect(() =>
      coldStepOf("sep", mod({ assets: undefined, onnx: undefined })),
    ).toThrow(/names no model/);
  });

  it("names a model this machine has not got as a machine problem, and says where", () => {
    // This one is fixed by downloading a file, the one above by editing a module.k7x.
    expect(() => coldStepOf("sep", mod({ onnx: undefined }))).toThrow(
      /not on this machine.*\.studio[\\/]models|not on this machine/,
    );
    expect(() => coldStepOf("sep", mod({ onnx: undefined }))).toThrow(
      /htdemucs\.onnx/,
    );
  });

  it("accepts one that has both, carrying the resolved path", () => {
    expect(coldStepOf("sep", mod())).toEqual({
      step: "sep",
      model: "/models/htdemucs.onnx",
      outputs: ["drums", "bass", "other", "vocals"],
    });
  });
});

describe("what a step says it writes", () => {
  it("is the four stems when the module names none of them", () => {
    // `out` is the port its TYPE gives it — a module that never spoke about stems.
    expect(
      coldStepOf("sep", mod({ outputs: [{ name: "out", type: "audio" }] }))
        .outputs,
    ).toEqual(["drums", "bass", "other", "vocals"]);
  });

  it("is the instrumental when that is what the module declares", () => {
    expect(
      coldStepOf(
        "sep",
        mod({ outputs: [{ name: "instrumental", type: "audio" }] }),
      ).outputs,
    ).toEqual(["instrumental"]);
  });

  it("refuses a module naming a stem and something no pass can write", () => {
    expect(() =>
      coldStepOf(
        "sep",
        mod({
          outputs: [
            { name: "vocals", type: "audio" },
            { name: "guitar", type: "audio" },
          ],
        }),
      ),
    ).toThrow(/guitar/);
  });
});

describe("where the outputs go", () => {
  it("is stems/ under the song's folder, not beside the master", () => {
    // scanSongs takes the first audio file in a folder as the master and does not descend.
    expect(
      coldOutDir(join("songs", "Artist", "Album", "Title", "original.wav")),
    ).toBe(join("songs", "Artist", "Album", "Title", STEMS_DIR));
  });
});

describe("running them", () => {
  it("does every step over every source, one at a time", async () => {
    const seen: string[] = [];
    const out = await runColdPasses(
      ["/a.wav", "/b.wav"],
      [{ step: "sep", model: "/m.onnx", outputs: ["vocals"] }],
      async ({ source, outDir }) => {
        seen.push(source);
        return [join(outDir, "vocals.wav")];
      },
    );
    expect(seen).toEqual(["/a.wav", "/b.wav"]);
    expect(out[0].files).toEqual([join(coldOutDir("/a.wav"), "vocals.wav")]);
  });

  it("stops at the first failure instead of collecting it", async () => {
    // A render after a silently-skipped step would apply a chain missing its first treatment.
    const seen: string[] = [];
    await expect(
      runColdPasses(
        ["/a.wav", "/b.wav"],
        [{ step: "sep", model: "/m.onnx", outputs: ["vocals"] }],
        async ({ source }) => {
          seen.push(source);
          throw new Error("no execution provider");
        },
      ),
    ).rejects.toThrow(/no execution provider/);
    expect(seen).toEqual(["/a.wav"]);
  });
});
