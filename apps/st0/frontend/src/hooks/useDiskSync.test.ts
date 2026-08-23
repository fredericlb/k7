// What the editor does when its file changes underneath it.
//
// One branch here can DISCARD someone's typing, and one can silently overwrite a file that changed. Both are
// data loss, and neither is visible in a screenshot — which is why the decision was pulled out of the hook and
// is tested here rather than clicked through.

import { describe, expect, it } from "vitest";
import { decideDiskSync } from "./useDiskSync";

const decide = (
  fresh: string,
  buffer: string,
  dirty: boolean,
  dismissed: string | null = null,
) => decideDiskSync({ fresh, buffer, dirty, dismissed });

describe("a file that changed on disk", () => {
  it("refreshes a clean buffer without asking", () => {
    // Nothing to lose, and NOT refreshing is worse: the editor would keep showing a version that no longer exists.
    expect(decide("new", "old", false)).toBe("adopt");
  });

  it("asks when there are unsaved edits and the two differ", () => {
    expect(decide("theirs", "mine", true)).toBe("conflict");
  });

  it("never touches the buffer on its own when it is dirty", () => {
    // The one rule worth stating as a rule: with unsaved edits, no path leads to "adopt".
    for (const [fresh, buffer] of [
      ["a", "b"],
      ["", "x"],
      ["long\ntext", "long\ntext!"],
    ])
      expect(decide(fresh, buffer, true)).not.toBe("adopt");
  });

  it("clears a stale dirty flag when the file already matches disk", () => {
    // Someone saved exactly what was in the buffer: leaving `dirty` on would keep offering to write bytes that are already there.
    expect(decide("same", "same", true)).toBe("clean");
  });

  it("does nothing when a clean buffer already matches", () => {
    expect(decide("same", "same", false)).toBe("ignore");
  });

  it("stops asking about a version the user chose to keep editing over", () => {
    // "Continue editing" has to survive the next poll two seconds later, or it is not a choice, it is a blink.
    expect(decide("theirs", "mine", true, "theirs")).toBe("ignore");
  });

  it("asks AGAIN when disk moves past the dismissed version", () => {
    // Dismissing is about one version, not the file: otherwise it silently opts out of every future warning for that file.
    expect(decide("theirs2", "mine", true, "theirs")).toBe("conflict");
  });

  it("treats an emptied file as a real change, not as nothing", () => {
    // "" is falsy, and a truthiness test here would skip the warning on the most destructive edit of all.
    expect(decide("", "mine", true)).toBe("conflict");
    expect(decide("", "mine", false)).toBe("adopt");
  });
});
