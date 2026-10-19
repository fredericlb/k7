import { describe, expect, it, vi } from "vitest";

// The gates must never change an answer, only skip a parse, so each case is checked against the reads it would have given ungated.

const parseSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@studio/ui-module-builder/module-ui", async (orig) => {
  const real =
    await orig<typeof import("@studio/ui-module-builder/module-ui")>();
  return {
    ...real,
    parseModuleDoc: (t: string) => {
      parseSpy.calls++;
      return real.parseModuleDoc(t);
    },
  };
});

const { readBuffer } = await import("./bufferReads");
const { scanSlices } = await import("./sliceSymbols");

const SLICE = `rack({
  rack_type: "slice",
  source: "break.wav",
  symbols: { BD: { note: 36, from: 0, to: 0.5 } },
})
`;

const reads = (text: string, path = "nodes/x.k7x") => {
  parseSpy.calls = 0;
  const r = readBuffer(text, path);
  return { ...r, parses: parseSpy.calls };
};

describe("readBuffer", () => {
  it("parses nothing for a file that names neither a rack nor an io", () => {
    expect(reads('name("lead")\nparams({ gain: 0.5 })\n')).toEqual({
      slices: false,
      io: null,
      channels: null,
      parses: 0,
    });
  });

  it("does not take `version` or `audio` for the word io", () => {
    expect(reads("version(2)\naudio(true)\n").parses).toBe(0);
  });

  it("parses ONCE for a slice rack that also extends something", () => {
    const r = reads(`extends("@k7-core/kit")\n${SLICE}`);
    expect(r.slices).toBe(true);
    expect(r.parses).toBe(1);
  });

  it("answers the slices as scanSlices does", () => {
    expect(reads(SLICE).slices).toBe(scanSlices(SLICE) != null);
    const broken = 'rack({ rack_type: "slice", symbols: [\n';
    expect(reads(broken).slices).toBe(false);
  });

  it("reads an input's io and channels from one parse", () => {
    const r = reads('extends("@meta/IN")\nchannel([3, 4])\n');
    expect(r).toEqual({ slices: false, io: "in", channels: [3, 4], parses: 1 });
  });

  it("keeps a channel spelled as a name", () => {
    expect(reads('io("in")\nchannel("Guitare")\n').channels).toBe("Guitare");
  });

  it("still finds an input by its PATH when the text names nothing", () => {
    const r = reads("channel([1])\n", "_modules/io/IN/in-1.k7x");
    expect(r.io).toBe("in");
    expect(r.parses).toBe(0);
  });

  it("reads no channels for an output", () => {
    expect(reads('io("out")\nchannel([1])\n').channels).toBe(null);
  });
});
