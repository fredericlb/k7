import { describe, expect, it } from "vitest";
import { isUiLine } from "./localCommands";
import { trackPlacing } from "./takeReview";
import type { WebProject } from "./types";

// `ui review <clip>` reopens the take review on any clip. It exists because the automatic one is a
// moment that passes: `lastTake` is the file service's MEMORY and dies with the process, and the ✓
// ends it for good — so a take could become unreachable while its file sat in clips/.
//
// The command names a clip; the panel says where it is playing. Working that out is the only thing
// the command has to do, and the interesting case is the one it was written for: a take that is on
// no lane at all.

const project = (tracks: { id: string; clips: string[] }[]): WebProject =>
  ({
    tracks: tracks.map((t) => ({
      id: t.id,
      clips: t.clips.map((id) => ({ id })),
    })),
  }) as unknown as WebProject;

describe("finding the lane a clip is on", () => {
  it("names the lane placing it", () => {
    const p = project([
      { id: "drums", clips: ["kick"] },
      { id: "gtr", clips: ["riff", "take1"] },
    ]);
    expect(trackPlacing(p, "take1")).toBe("gtr");
    expect(trackPlacing(p, "kick")).toBe("drums");
  });

  it("answers EMPTY for a clip nothing places — the orphan take this is for", () => {
    // Not a failure: the waveform, the onsets and the level are properties of the file, and a take
    // whose placement was never written reviews exactly the same.
    expect(trackPlacing(project([{ id: "gtr", clips: [] }]), "orphan")).toBe(
      "",
    );
  });

  it("takes the first lane when a clip sits on several", () => {
    // A placement is a reference, so one clip may be on many. The label answers "where is this
    // playing" — listing them all would say less, not more.
    const p = project([
      { id: "a", clips: ["shared"] },
      { id: "b", clips: ["shared"] },
    ]);
    expect(trackPlacing(p, "shared")).toBe("a");
  });

  it("does not throw before the project has loaded, or on an empty name", () => {
    expect(trackPlacing(null, "take1")).toBe("");
    expect(trackPlacing(project([{ id: "gtr", clips: ["x"] }]), "")).toBe("");
  });
});

describe("the command itself", () => {
  it("is a `ui` line, so the shell answers it rather than the backend", () => {
    // It opens a VIEW and writes nothing — what the panel then does (normalize, onsets) is the
    // brain's. The pairing is enforced both ways, so being in the table is what makes it dispatch.
    expect(isUiLine("review ge.rythm_1.1_260814T194357")).toBe(true);
  });

  it("does not swallow a bare `review`, which names no clip", () => {
    // Bare heads still reach the branch, which answers with a usage line rather than falling
    // through to the backend as an unknown verb.
    expect(isUiLine("review")).toBe(true);
  });
});
