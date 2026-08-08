import { describe, expect, it } from "vitest";
import {
  enginePluginFor,
  mediatekModulePath,
  readExtends,
  resolvePluginBlock,
} from "./resolvePlugin";

// What the machine reported, in the two fields naming a plugin takes.
const SCAN = [
  { name: "ADClip 7", format: "internal" },
  { name: "ARP 2600 V3", format: "VST3" },
  { name: "Neural Amp Modeler", format: "VST3" },
];

/** A face, exactly as `engineFaceModule` writes one. */
const face = (ref: string) =>
  `# a face\n# for something\nextends: ${JSON.stringify(ref)}\n`;

const noFiles = async (): Promise<string> => {
  throw new Error("nothing to read");
};

describe("readExtends", () => {
  it("reads the ref a face declares", () => {
    expect(readExtends(face("@engine/adclip-7"))).toBe("@engine/adclip-7");
    expect(readExtends("extends: '@engine/x'\n")).toBe("@engine/x");
    expect(readExtends("extends: audio/reverb\n")).toBe("audio/reverb");
  });

  it("says nothing where there is nothing to say", () => {
    // The real library holds `extends: ""` on a module built from its own assets.
    expect(readExtends('extends: ""\nplugin: {}\n')).toBe("");
    expect(readExtends("plugin: { type: vst3 }\n")).toBe("");
  });
});

describe("enginePluginFor", () => {
  it("spells the plugin the way a compiled document does", () => {
    // The format lowercased and the plugin's REAL name — `engineModuleOf`'s rule, shared with
    // engineCatalogue. A different spelling here previews something the document never loads.
    expect(enginePluginFor("@engine/adclip-7", SCAN)).toEqual({
      type: "internal",
      name: "ADClip 7",
    });
    expect(enginePluginFor("@engine/arp-2600-v3", SCAN)).toEqual({
      type: "vst3",
      name: "ARP 2600 V3",
    });
  });

  it("says nothing for a ref this machine has not scanned", () => {
    // The face survives the machine that cannot load it — the panel is still editable, there
    // are simply no parameters to report.
    expect(enginePluginFor("@engine/serum", SCAN)).toBeUndefined();
    expect(enginePluginFor("@mediatek/audio/x", SCAN)).toBeUndefined();
  });
});

describe("resolvePluginBlock", () => {
  it("finds the plugin a face inherits", async () => {
    // The bug this exists for: a face declares nothing but the ref, so reading the text alone
    // found no plugin, the engine loaded nothing, and the parameter list was empty.
    expect(
      await resolvePluginBlock(face("@engine/adclip-7"), SCAN, noFiles),
    ).toEqual({ type: "internal", name: "ADClip 7" });
  });

  it("follows a chain through the médiathèque", async () => {
    // Measured on the real library: `audio/amps/guitar` extends a face, which extends the scan.
    const files: Record<string, string> = {
      "modules/audio/amps/neural-amp-modeler/module.yaml": face(
        "@engine/neural-amp-modeler",
      ),
    };
    const got = await resolvePluginBlock(
      'extends: "@mediatek/audio/amps/neural-amp-modeler"\nparams:\n  nam: x.nam\n',
      SCAN,
      async (p) => files[p] ?? Promise.reject(new Error("no such file")),
    );
    expect(got).toEqual({ type: "vst3", name: "Neural Amp Modeler" });
  });

  it("lets a module's OWN plugin win over what it extends", async () => {
    // What `resolveModule` does too: a module that declares its plugin is not asking to
    // inherit one.
    expect(
      await resolvePluginBlock(
        'extends: "@engine/adclip-7"\nplugin:\n  type: vst3\n  name: Serum\n',
        SCAN,
        noFiles,
      ),
    ).toEqual({ type: "vst3", name: "Serum" });
  });

  it("stops on a ref no level here can reach", async () => {
    // A bare or `@project/…` ref belongs to a project, and this app edits a library — there is
    // nowhere to look, which is a different answer from "the plugin is missing".
    expect(
      await resolvePluginBlock(face("audio/reverb"), SCAN, noFiles),
    ).toBeUndefined();
    expect(
      await resolvePluginBlock("# nothing at all\n", SCAN, noFiles),
    ).toBeUndefined();
  });

  it("survives a ref pointing at a file that is not there", async () => {
    expect(
      await resolvePluginBlock(face("@mediatek/audio/gone"), SCAN, noFiles),
    ).toBeUndefined();
  });

  it("does not spin on a cycle", async () => {
    const files: Record<string, string> = {
      "modules/a/module.yaml": face("@mediatek/b"),
      "modules/b/module.yaml": face("@mediatek/a"),
    };
    expect(
      await resolvePluginBlock(
        face("@mediatek/a"),
        SCAN,
        async (p) => files[p] ?? "",
      ),
    ).toBeUndefined();
  });
});

describe("mediatekModulePath", () => {
  it("maps a library ref onto the file behind it", () => {
    expect(mediatekModulePath("@mediatek/audio/utility/mixer")).toBe(
      "modules/audio/utility/mixer/module.yaml",
    );
    expect(mediatekModulePath("@engine/mixer")).toBe("");
  });
});
