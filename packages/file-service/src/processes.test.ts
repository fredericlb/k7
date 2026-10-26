// processes.test.ts — the project bar's process list as the file service keeps it: what would go wrong
// unseen is a quick command blinking the button, a finished one vanishing before a poll saw it end,
// and progress said deep inside a run reaching no process.

import { describe, expect, it } from "vitest";
import {
  currentProcess,
  LINGER_MS,
  listProcesses,
  runAsProcess,
  tagLabel,
} from "./processes.ts";

const mine = (label: string) =>
  listProcesses().filter((p) => p.label === label);

describe("runAsProcess", () => {
  it("lists a run with the progress said inside it, then how it ended", async () => {
    let during: ReturnType<typeof listProcesses> = [];
    await runAsProcess("track transcribe cam subs", async () => {
      await Promise.resolve();
      currentProcess()?.progress(0.25, "listening");
      during = mine("track transcribe cam subs");
    });
    expect(during).toMatchObject([
      { state: "running", progress: 0.25, detail: "listening" },
    ]);
    const [ended] = mine("track transcribe cam subs");
    expect(ended).toMatchObject({ state: "done" });
    expect(ended?.progress).toBeUndefined();
    expect(
      listProcesses(Date.now() + LINGER_MS + 1).some(
        (p) => p.label === "track transcribe cam subs",
      ),
    ).toBe(false);
  });

  it("never lists a run that ended before it was due to show", async () => {
    await runAsProcess("event move a 2", async () => "ok", {
      showAfterMs: 60_000,
    });
    expect(
      listProcesses(Date.now() + 120_000).map((p) => p.label),
    ).not.toContain("event move a 2");
  });

  it("says a throw and a refusal as a failure, with the reason", async () => {
    await expect(
      runAsProcess("picture render", async () => {
        throw new Error("no chromium");
      }),
    ).rejects.toThrow("no chromium");
    expect(mine("picture render")).toMatchObject([
      { state: "failed", detail: "no chromium" },
    ]);
    await runAsProcess("clip process x", async () => ["nope"], {
      failed: (v) => v[0],
    });
    expect(mine("clip process x")).toMatchObject([
      { state: "failed", detail: "nope" },
    ]);
  });
});

describe("tagLabel", () => {
  it("shortens the absolute path a background tag ends with", () => {
    expect(
      tagLabel("picture prepare /home/me/My Songs/a.k7/clips/VID 1.mp4"),
    ).toBe("picture prepare VID 1.mp4");
    expect(tagLabel("picture prepare C:\\Users\\me\\a.k7\\clips\\v.mp4")).toBe(
      "picture prepare v.mp4",
    );
    expect(tagLabel("picture render")).toBe("picture render");
  });
});
