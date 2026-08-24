// The fixtures are real `reg query` output, this machine's first: it is the case the mapping was
// verified against, with nvidia-smi confirming deviceId 0 is the discrete card.

import { describe, expect, it } from "vitest";
import { chooseAdapter, parseDirectXCache } from "./dmlAdapters";

const DESKTOP = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX
    DxDbVersion    REG_SZ    1.8.6
    MaxDedicatedVideoMemory    REG_QWORD    0x2ea700000

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\ShaderCache
    AdapterLuid    REG_QWORD    0x0

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{36934A8B-DE9B-11F0-B93C-806E6F6E6963}
    AdapterType    REG_DWORD    0x105
    Description    REG_SZ    Microsoft Basic Render Driver
    AdapterLuid    REG_QWORD    0x115cd
    DedicatedVideoMemory    REG_QWORD    0x0

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{BE6411C2-05DB-11F1-B959-806E6F6E6963}
    AdapterType    REG_DWORD    0x2323
    Description    REG_SZ    AMD Radeon(TM) Graphics
    AdapterLuid    REG_QWORD    0x11602
    DedicatedVideoMemory    REG_QWORD    0x1e5c8000

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{E9AF8DFB-FEDA-11F0-B955-83B513F63868}
    AdapterType    REG_DWORD    0x31b
    Description    REG_SZ    NVIDIA GeForce RTX 5070
    AdapterLuid    REG_QWORD    0xe453
    DedicatedVideoMemory    REG_QWORD    0x2ea700000
`;

// The same two GPUs with the panel on the iGPU: the discrete card is no longer index 0.
const LAPTOP = DESKTOP.replace("0x2323", "0x232b").replace("0x31b", "0x313");

const ONLY_INTEGRATED = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{A}
    AdapterType    REG_DWORD    0x232b
    Description    REG_SZ    AMD Radeon(TM) Graphics
    DedicatedVideoMemory    REG_QWORD    0x1e5c8000
`;

describe("parseDirectXCache", () => {
  it("keeps the entries that describe an adapter and drops the rest", () => {
    const a = parseDirectXCache(DESKTOP);
    expect(a.map((x) => x.name)).toEqual([
      "Microsoft Basic Render Driver",
      "AMD Radeon(TM) Graphics",
      "NVIDIA GeForce RTX 5070",
    ]);
    expect(a[2].type).toBe(0x31b);
    expect(a[2].vram).toBe(0x2ea700000);
  });

  it("reads nothing out of empty or unrelated output", () => {
    expect(parseDirectXCache("")).toEqual([]);
    expect(parseDirectXCache("ERROR: the system was unable to find")).toEqual(
      [],
    );
  });
});

describe("chooseAdapter", () => {
  it("takes the discrete card at 0 when it is the one that POSTed", () => {
    expect(chooseAdapter(parseDirectXCache(DESKTOP))).toEqual({
      kind: "adapter",
      deviceId: 0,
      name: "NVIDIA GeForce RTX 5070",
    });
  });

  it("takes 1 when the integrated GPU drives the display", () => {
    expect(chooseAdapter(parseDirectXCache(LAPTOP))).toEqual({
      kind: "adapter",
      deviceId: 1,
      name: "NVIDIA GeForce RTX 5070",
    });
  });

  it("says so rather than choosing when every GPU is integrated", () => {
    expect(chooseAdapter(parseDirectXCache(ONLY_INTEGRATED))).toEqual({
      kind: "integrated-only",
      name: "AMD Radeon(TM) Graphics",
    });
  });

  it("gives up on an adapter list with no POST device rather than guessing", () => {
    const none = parseDirectXCache(DESKTOP.replace("0x31b", "0x313"));
    expect(chooseAdapter(none)).toEqual({ kind: "unknown" });
  });

  it("calls a flagless adapter with little VRAM integrated all the same", () => {
    const tiny = [{ name: "Some iGPU", type: 0xb, vram: 512 * 1024 * 1024 }];
    expect(chooseAdapter(tiny)).toEqual({
      kind: "integrated-only",
      name: "Some iGPU",
    });
  });
});
