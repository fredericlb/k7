import { describe, expect, it } from "vitest";
import { allAdded, parseUnifiedDiff } from "./unifiedDiff";

const DIFF = `diff --git a/song.yaml b/song.yaml
index 1111111..2222222 100644
--- a/song.yaml
+++ b/song.yaml
@@ -2,3 +2,3 @@ name: a
 tempo: 120
-key: C
+key: D
 bars: 8
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  it("drops file headers and numbers both sides", () => {
    expect(parseUnifiedDiff(DIFF)).toEqual([
      { kind: "hunk", text: "@@ -2,3 +2,3 @@ name: a" },
      { kind: "ctx", text: "tempo: 120", old: 2, new: 2 },
      { kind: "del", text: "key: C", old: 3 },
      { kind: "add", text: "key: D", new: 3 },
      { kind: "ctx", text: "bars: 8", old: 4, new: 4 },
      { kind: "note", text: "\\ No newline at end of file" },
    ]);
  });

  it("keeps git's binary notice", () => {
    const rows = parseUnifiedDiff(
      "diff --git a/x.wav b/x.wav\nindex 1..2 100644\nBinary files a/x.wav and b/x.wav differ\n",
    );
    expect(rows).toEqual([
      { kind: "note", text: "Binary files a/x.wav and b/x.wav differ" },
    ]);
  });

  it("keeps a removed line that reads like a header", () => {
    const rows = parseUnifiedDiff(
      "--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old\n+++ new\n",
    );
    expect(rows.slice(1)).toEqual([
      { kind: "del", text: "-- old", old: 1 },
      { kind: "add", text: "++ new", new: 1 },
    ]);
  });

  it("is empty for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("allAdded", () => {
  it("adds every line", () => {
    expect(allAdded("a\nb\n").slice(1)).toEqual([
      { kind: "add", text: "a", new: 1 },
      { kind: "add", text: "b", new: 2 },
    ]);
  });
});
