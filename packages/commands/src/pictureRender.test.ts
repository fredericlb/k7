// `picture render` against a fake host: the words reach the renderer as the browser export reads
// them, the work runs in the background once, and a host with no renderer says where to go instead.

import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const logs: string[] = [];
const refusals: string[] = [];
const asked: unknown[] = [];
let queued: (() => Promise<string>)[] = [];
const host = (opts: { render?: boolean; background?: boolean } = {}) =>
  ({
    songPath: "/song.k7",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
    ...(opts.render === false
      ? {}
      : {
          renderPicture: async (o: unknown) => {
            asked.push(o);
            return "exports/song.mp4";
          },
        }),
    ...(opts.background === false
      ? {}
      : {
          background: (_tag: string, work: () => Promise<string>) => {
            if (queued.length) return false;
            queued.push(work);
            return true;
          },
        }),
  }) as never;

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  asked.length = 0;
  queued = [];
});

describe("picture render", () => {
  it("hands the export's own settings to the renderer, in the background", async () => {
    await runCommand(
      "picture render mp4 none size=720p quality=max from=0:10 to=40",
      host(),
      "cli",
    );
    expect(refusals).toEqual([]);
    expect(logs[0]).toMatch(/in the background \(mp4, silent\)/);
    expect(await queued[0]?.()).toBe("picture rendered: exports/song.mp4");
    expect(asked).toEqual([
      {
        format: "mp4",
        audio: false,
        size: { height: 720 },
        quality: "max",
        from: 10,
        to: 40,
      },
    ]);
  });

  it("defaults to a webm with the mixdown, and waits when the host has no background", async () => {
    await runCommand("picture render", host({ background: false }), "cli");
    expect(asked).toEqual([{ format: "webm", audio: true }]);
    expect(logs).toEqual(["picture rendered: exports/song.mp4"]);
  });

  it("refuses a second render while one runs, a setting it cannot read, and a host with no renderer", async () => {
    const h = host();
    await runCommand("picture render", h, "cli");
    await runCommand("picture render", h, "cli");
    await runCommand("picture render size=huge", h, "cli");
    await runCommand("picture render", host({ render: false }), "cli");
    expect(refusals[0]).toMatch(/already running/);
    expect(refusals[1]).toMatch(/^usage: picture render/);
    expect(refusals[2]).toMatch(/project export video/);
  });
});
