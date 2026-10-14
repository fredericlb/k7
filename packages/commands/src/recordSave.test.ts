// `node record save` and the ARGUMENT it is given: an absolute path the card read off a state
// frame, JSON-quoted by the caller because on Windows it is full of backslashes.
//
// It is here rather than beside recorderSave.ts because the failure was neither end's: the file
// service checked a path that had already lost its meaning between the browser and this handler,
// and refused it as "not one of this project's takes". See packages/song/docs/recorderNode.md.

import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const WIN = "C:\\Users\\flb\\.studio\\root\\me\\live.k7\\clips\\rec-1.wav";

/** A host that saves nothing and only remembers what it was asked to save. */
function host(): {
  h: never;
  seen: { file?: string; label?: string };
  logs: string[];
} {
  const seen: { file?: string; label?: string } = {};
  const logs: string[] = [];
  return {
    seen,
    logs,
    h: {
      songPath: "/nowhere",
      log: (l: string[]) => logs.push(...l),
      refuse: (l: string[]) => logs.push(...l),
      saveTake: async (file: string, label?: string) => {
        seen.file = file;
        seen.label = label;
        return "recordings/2026-08-27/20-18-10.wav";
      },
    } as never,
  };
}

describe("node record save", () => {
  it("hands the file service the path the caller meant, backslashes and all", async () => {
    const { h, seen } = host();
    // Exactly what the card sends — `JSON.stringify` of the take's own path.
    await runCommand(`node record save ${JSON.stringify(WIN)}`, h, "cli");
    expect(seen.file).toBe(WIN);
    expect(seen.label).toBeUndefined();
  });

  it("keeps a path with spaces whole, which is what the quoting is for", async () => {
    const { h, seen } = host();
    const spaced = "C:\\Users\\flb\\My Rig\\live.k7\\clips\\rec-1.wav";
    await runCommand(`node record save ${JSON.stringify(spaced)}`, h, "cli");
    expect(seen.file).toBe(spaced);
  });

  it("reads whatever follows the path as the take's name", async () => {
    const { h, seen } = host();
    await runCommand(
      `node record save ${JSON.stringify(WIN)} the second solo`,
      h,
      "cli",
    );
    expect(seen.file).toBe(WIN);
    expect(seen.label).toBe("the second solo");
  });

  it("still takes a bare path, which is what a CLI user types", async () => {
    const { h, seen } = host();
    await runCommand(
      "node record save /home/flb/live.k7/clips/rec-1.wav",
      h,
      "cli",
    );
    expect(seen.file).toBe("/home/flb/live.k7/clips/rec-1.wav");
  });

  it("says where it landed", async () => {
    const { h, logs } = host();
    await runCommand(`node record save ${JSON.stringify(WIN)}`, h, "cli");
    expect(logs).toEqual(["saved recordings/2026-08-27/20-18-10.wav"]);
  });

  it("refuses a host with no médiathèque behind it rather than failing quietly", async () => {
    const logs: string[] = [];
    await runCommand(
      `node record save ${JSON.stringify(WIN)}`,
      {
        songPath: "/nowhere",
        log: (l: string[]) => logs.push(...l),
        refuse: (l: string[]) => logs.push(...l),
      } as never,
      "cli",
    );
    expect(logs.join(" ")).toContain("nowhere near the recording");
  });
});
