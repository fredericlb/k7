// The commit log the History panel lists, parsed: paths made relative to the project, others dropped.

import { describe, expect, it } from "vitest";
import { parseCommitLog } from "./projectCommits.ts";

const US = "\x1f";
const RS = "\x1e";

describe("parseCommitLog", () => {
  it("reads hash, time, author and subject, and keeps only the project's files", () => {
    const out =
      `${RS}abc123${US}1791550000${US}Fred${US}sync\n\n` +
      "song.st0/tracks/da.main.yaml\nother.st0/project.yaml\nsong.st0/chains/be.bass.yaml\n" +
      `${RS}def456${US}1791540000${US}Fred${US}a subject: with a colon\n\nsong.st0/project.yaml\n`;
    expect(parseCommitLog(out, "song.st0")).toEqual([
      {
        hash: "abc123",
        ts: 1791550000000,
        author: "Fred",
        subject: "sync",
        paths: ["tracks/da.main.yaml", "chains/be.bass.yaml"],
      },
      {
        hash: "def456",
        ts: 1791540000000,
        author: "Fred",
        subject: "a subject: with a colon",
        paths: ["project.yaml"],
      },
    ]);
  });

  it("answers nothing for an empty log", () => {
    expect(parseCommitLog("", "song.st0")).toEqual([]);
  });
});
