import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout } from "./layout.ts";
import { manifest } from "./manifest.ts";
import { NotAudioError } from "./morceau.ts";
import {
  addRecording,
  dayOf,
  listRecordings,
  momentStem,
  stampOf,
} from "./recordings.ts";
import { revisions } from "./revision.ts";
import { scanFamily } from "./scan.ts";
import { putFile } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-rec-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

// 21:05:07 local — an evening rehearsal, which is the case UTC would file under tomorrow.
const evening = new Date(2026, 7, 3, 21, 5, 7);
// A ROOT zone, beside the families and inside none of them.
const rec = (...p: string[]) => join(root, "recordings", ...p);

describe("naming a capture", () => {
  it("is the local day and the local second", () => {
    expect(dayOf(evening)).toBe("2026-08-03");
    expect(stampOf(evening)).toBe("21-05-07");
  });

  it("pads, so the names sort as the clock runs", () => {
    expect(stampOf(new Date(2026, 7, 3, 9, 4, 5))).toBe("09-04-05");
  });
});

describe("naming a moment", () => {
  it("carries the hour, the length and the name", () => {
    expect(momentStem(evening, 15, "Le solo de Jean-Mi")).toBe(
      "moment-21-05-07--15--Le solo de Jean-Mi",
    );
  });

  it("stops after the length when the moment has no name", () => {
    expect(momentStem(evening, 15)).toBe("moment-21-05-07--15");
    expect(momentStem(evening, 15, "   ")).toBe("moment-21-05-07--15");
  });

  it("rounds the length — a file name is not where fractions of a second live", () => {
    expect(momentStem(evening, 15.4)).toBe("moment-21-05-07--15");
    expect(momentStem(evening, 15.6)).toBe("moment-21-05-07--16");
  });

  it("collapses a name's own run of hyphens, which `--` separates fields with", () => {
    expect(momentStem(evening, 8, "Solo -- fin")).toBe(
      "moment-21-05-07--8--Solo - fin",
    );
  });

  it("keeps a name from becoming a path", () => {
    expect(momentStem(evening, 8, "AC/DC")).toBe("moment-21-05-07--8--AC DC");
  });
});

describe("filing a capture", () => {
  it("creates the day and lands under the second", () => {
    const r = addRecording({
      filename: "take.mp3",
      bytes: Buffer.from("ID3"),
      at: evening,
    });
    expect(r.path).toBe("recordings/2026-08-03/21-05-07.mp3");
    expect(readFileSync(rec("2026-08-03", "21-05-07.mp3"), "utf8")).toBe("ID3");
  });

  it("keeps both when two land on the same second", () => {
    // Two microphones stopping together is an afternoon, not a conflict — unlike a morceau,
    // where two uploads deducing one folder mean the same morceau twice.
    addRecording({ filename: "a.mp3", bytes: Buffer.from("a"), at: evening });
    const second = addRecording({
      filename: "b.mp3",
      bytes: Buffer.from("b"),
      at: evening,
    });
    expect(second.name).toBe("21-05-07-2.mp3");
    expect(readFileSync(rec("2026-08-03", "21-05-07.mp3"), "utf8")).toBe("a");
    expect(readFileSync(rec("2026-08-03", "21-05-07-2.mp3"), "utf8")).toBe("b");
  });

  it("uses the server clock when the caller names no moment", () => {
    const r = addRecording({ filename: "x.mp3", bytes: Buffer.from("x") });
    expect(r.day).toBe(dayOf(new Date()));
    expect(existsSync(join(root, r.path))).toBe(true);
  });

  it("refuses what is not audio", () => {
    expect(() =>
      addRecording({ filename: "notes.txt", bytes: Buffer.from("x") }),
    ).toThrow(NotAudioError);
  });

  it("files a MOMENT in the same day folder, named as an extract", () => {
    // Same folder as the captures on purpose: a moment IS one, a shorter one, and
    // splitting it off would make "what did we play that evening" two places.
    const r = addRecording({
      filename: "moment.webm",
      bytes: Buffer.from("clip"),
      at: evening,
      durationSec: 15,
      label: "Le solo",
    });
    expect(r.path).toBe(
      "recordings/2026-08-03/moment-21-05-07--15--Le solo.webm",
    );
    expect(listRecordings()[0].files).toHaveLength(1);
  });

  it("keeps two moments cut at the same second and the same length", () => {
    const one = { at: evening, durationSec: 15, label: "Solo" };
    addRecording({ filename: "a.webm", bytes: Buffer.from("a"), ...one });
    const second = addRecording({
      filename: "b.webm",
      bytes: Buffer.from("b"),
      ...one,
    });
    expect(second.name).toBe("moment-21-05-07--15--Solo-2.webm");
  });
});

describe("listing the zone", () => {
  it("gives newest day first and each day's captures in clock order", () => {
    addRecording({
      filename: "a.mp3",
      bytes: Buffer.from("a"),
      at: new Date(2026, 7, 3, 21, 5, 7),
    });
    addRecording({
      filename: "b.mp3",
      bytes: Buffer.from("bb"),
      at: new Date(2026, 7, 3, 9, 0, 0),
    });
    addRecording({
      filename: "c.mp3",
      bytes: Buffer.from("c"),
      at: new Date(2026, 7, 4, 10, 0, 0),
    });
    const days = listRecordings();
    expect(days.map((d) => d.day)).toEqual(["2026-08-04", "2026-08-03"]);
    expect(days[1].files.map((f) => f.name)).toEqual([
      "09-00-00.mp3",
      "21-05-07.mp3",
    ]);
    expect(days[1].files[0].bytes).toBe(2);
    expect(days[1].files[0].path).toBe("recordings/2026-08-03/09-00-00.mp3");
  });

  it("is empty, not broken, before the first capture", () => {
    expect(listRecordings()).toEqual([]);
  });
});

describe("what the zone is NOT", () => {
  it("produces no catalogue entry", () => {
    // The whole point of the choice: a firehose of untitled captures would drown the
    // morceaux listing. The scan visits families, and this is not in one.
    addRecording({ filename: "a.mp3", bytes: Buffer.from("a"), at: evening });
    expect(scanFamily("morceaux")).toEqual([]);
  });

  it("stays out of the manifest a cache syncs against", () => {
    putFile("morceaux/imported/A/B/C/original.mp3", "real");
    addRecording({ filename: "a.mp3", bytes: Buffer.from("a"), at: evening });
    const paths = manifest("morceaux").map((f) => f.path);
    expect(paths).toContain("morceaux/imported/A/B/C/original.mp3");
    expect(paths.some((p) => p.includes("recordings"))).toBe(false);
  });

  it("moves its OWN token and leaves the families' alone", () => {
    // It used to ride on morceaux, which cost that family a refetch per capture. A zone at
    // the root answers for itself, and the poll reads both from the same map.
    const before = revisions();
    addRecording({ filename: "a.mp3", bytes: Buffer.from("a"), at: evening });
    const after = revisions();
    expect(after.recordings).not.toBe(before.recordings);
    expect(after.morceaux).toBe(before.morceaux);
  });
});
