// `project record save` and the ARGUMENTS it is given: the engine's take, an absolute path off a state frame,
// JSON-quoted because on Windows it is full of backslashes, then the page's picture beside it, or `none` for a
// picture alone. See packages/song/docs/outputRecording.md.

import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const WIN = "C:\\Users\\flb\\.studio\\root\\me\\live.k7\\clips\\rec-1.wav";

/** A host that saves nothing and only remembers what it was asked to save. */
function host(saves = true): {
  h: never;
  seen: { file?: string; video?: string } | null;
  logs: string[];
} {
  const out = {
    seen: null as { file?: string; video?: string } | null,
    logs: [] as string[],
  };
  return {
    ...out,
    get seen() {
      return out.seen;
    },
    h: {
      songPath: "/nowhere",
      log: (l: string[]) => out.logs.push(...l),
      refuse: (l: string[]) => out.logs.push(...l),
      ...(saves
        ? {
            saveTake: async (take: { file?: string; video?: string }) => {
              out.seen = take;
              return "recordings/2026-08-27/20-18-10.webm";
            },
          }
        : {}),
    } as never,
  };
}

describe("project record save", () => {
  it("hands the file service the take the caller meant, backslashes and all", async () => {
    const t = host();
    await runCommand(`project record save ${JSON.stringify(WIN)}`, t.h, "cli");
    expect(t.seen).toEqual({ file: WIN });
  });

  it("carries the picture beside the take, and a picture alone with `none`", async () => {
    const t = host();
    const video = "clips/output-260827-201810.webm";
    await runCommand(
      `project record save ${JSON.stringify(WIN)} ${JSON.stringify(video)}`,
      t.h,
      "cli",
    );
    expect(t.seen).toEqual({ file: WIN, video });
    const alone = host();
    await runCommand(
      `project record save none ${JSON.stringify(video)}`,
      alone.h,
      "cli",
    );
    expect(alone.seen).toEqual({ video });
  });

  it("says where it landed", async () => {
    const t = host();
    await runCommand(`project record save ${JSON.stringify(WIN)}`, t.h, "cli");
    expect(t.logs).toEqual(["saved recordings/2026-08-27/20-18-10.webm"]);
  });

  it("refuses nothing to save, and a host with no médiathèque behind it", async () => {
    const empty = host();
    await runCommand("project record save none", empty.h, "cli");
    expect(empty.seen).toBeNull();
    const far = host(false);
    await runCommand(
      `project record save ${JSON.stringify(WIN)}`,
      far.h,
      "cli",
    );
    expect(far.logs.join(" ")).toMatch(/cannot save a take/);
  });
});
