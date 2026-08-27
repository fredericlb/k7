// A take's path arrives from the BROWSER — it read it off a state frame — so the one thing this
// module must get right is refusing every path that is not one of this project's own takes.
// Everything else here is bookkeeping; the guard is the reason the file exists.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insideDir } from "./recorderSave.ts";

let root: string;
let takes: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-rec-"));
  takes = join(root, "takes");
  mkdirSync(takes, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("what counts as one of this project's takes", () => {
  it("accepts a file in the record directory", () => {
    expect(insideDir(takes, join(takes, "rec-260827T143208.wav"))).toBe(true);
  });

  it("accepts one further down, since a take folder may have days in it", () => {
    expect(insideDir(takes, join(takes, "2026-08-27", "a.wav"))).toBe(true);
  });

  it("refuses a path that walks OUT with ..", () => {
    // The attack the guard is for: a browser naming any file on the machine.
    expect(insideDir(takes, join(takes, "..", "..", "secrets.wav"))).toBe(
      false,
    );
    expect(insideDir(takes, join(root, "elsewhere.wav"))).toBe(false);
  });

  it("refuses a sibling whose name STARTS with the directory's", () => {
    // The prefix bug: "/takes-old/x.wav" begins with "/takes" and is not inside it.
    expect(insideDir(takes, join(root, "takes-old", "x.wav"))).toBe(false);
  });

  it("refuses everything when the project has NO record directory", () => {
    // An empty recordDir must not read as "anywhere is fine".
    expect(insideDir("", join(takes, "a.wav"))).toBe(false);
  });
});

describe("saveTake", () => {
  const wav = () => {
    const at = join(takes, "rec-260827T143208.wav");
    writeFileSync(at, Buffer.from([1, 2, 3, 4]));
    return at;
  };

  it("refuses a take from outside the record directory, before reading anything", async () => {
    const { saveTake } = await import("./recorderSave.ts");
    await expect(
      saveTake({ recordDir: takes, file: join(root, "elsewhere.wav") }),
    ).rejects.toThrow(/not one of this project's takes/);
  });

  it("pushes the bytes, stamped with the take's OWN time", async () => {
    vi.resetModules();
    const pushRecording = vi.fn().mockResolvedValue({
      path: "recordings/2026-08-27/14-32-08.wav",
      day: "2026-08-27",
      name: "14-32-08.wav",
    });
    vi.doMock("@studio/mediatek/remote", () => ({ pushRecording }));
    vi.doMock("./mediatekLink.ts", () => ({
      mediatekBase: () => "https://pl8.example",
      mediatekToken: () => "t",
    }));
    const { saveTake } = await import("./recorderSave.ts");

    const file = wav();
    // Played an hour ago, saved now: the take belongs to the hour it was PLAYED.
    const then = new Date("2026-08-27T14:32:08Z");
    utimesSync(file, then, then);

    const res = await saveTake({ recordDir: takes, file, label: "the solo" });
    expect(res.path).toBe("recordings/2026-08-27/14-32-08.wav");
    expect(res.bytes).toBe(4);
    const [, opts] = pushRecording.mock.calls[0];
    expect(opts.filename).toBe("rec-260827T143208.wav");
    expect(opts.bytes).toHaveLength(4);
    expect(opts.at.getTime()).toBe(then.getTime());
    expect(opts.label).toBe("the solo");
    vi.doUnmock("@studio/mediatek/remote");
    vi.doUnmock("./mediatekLink.ts");
  });

  it("says so when the machine has no médiathèque, rather than failing on the push", async () => {
    vi.resetModules();
    vi.doMock("./mediatekLink.ts", () => ({
      mediatekBase: () => null,
      mediatekToken: () => null,
    }));
    const { saveTake } = await import("./recorderSave.ts");
    await expect(saveTake({ recordDir: takes, file: wav() })).rejects.toThrow(
      /no médiathèque/,
    );
    vi.doUnmock("./mediatekLink.ts");
  });
});
