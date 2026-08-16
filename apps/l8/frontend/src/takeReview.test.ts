import { describe, expect, it } from "vitest";
import { isUiLine } from "./localCommands";
import { placedBeat, takeOptions, trackPlacing } from "./takeReview";
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

// The sidebar the panel draws when a recording left several passes behind: every version of the
// lane there is to listen to. See packages/song/docs/takes.md.

const withTakes = (
  clips: { id: string; start: number }[],
  takes: { name?: string; clips: { id: string; start: number }[] }[],
): WebProject =>
  ({
    tracks: [{ id: "gtr", clips, takes }],
  }) as unknown as WebProject;

describe("the takes to choose between", () => {
  it("lists them in SLOT order, with what is playing last", () => {
    // Slot order, not chronological: a `select` exchanges two lists, so a row's number does not
    // move when you audition it and the list stays put under the pointer.
    const p = withTakes(
      [{ id: "pass3", start: 8 }],
      [
        { clips: [{ id: "pass1", start: 8 }] },
        { clips: [{ id: "pass2", start: 8 }] },
      ],
    );
    expect(takeOptions(p, "gtr").map((t) => [t.n, t.clip])).toEqual([
      [1, "pass1"],
      [2, "pass2"],
      [null, "pass3"],
    ]);
  });

  it("says where each one BEGINS — the earliest event, not the first written", () => {
    // The number is what the playhead is sent to, and a list of placements is not necessarily
    // in time order.
    const p = withTakes(
      [{ id: "a", start: 0 }],
      [
        {
          clips: [
            { id: "late", start: 32 },
            { id: "early", start: 16 },
          ],
        },
      ],
    );
    const [take] = takeOptions(p, "gtr");
    expect(take.startBeat).toBe(16);
    expect(take.events).toBe(2);
    // The row draws ONE waveform, and it is the first placement's.
    expect(take.clip).toBe("late");
  });

  it("carries a take's name when it has one", () => {
    const p = withTakes(
      [{ id: "a", start: 0 }],
      [{ name: "the quiet one", clips: [{ id: "b", start: 0 }] }],
    );
    expect(takeOptions(p, "gtr")[0].name).toBe("the quiet one");
    expect(takeOptions(p, "gtr")[1].name).toBeUndefined();
  });

  it("is EMPTY for a lane with no takes — a choice of one is no choice", () => {
    expect(takeOptions(withTakes([{ id: "a", start: 0 }], []), "gtr")).toEqual(
      [],
    );
    expect(takeOptions(null, "gtr")).toEqual([]);
    expect(
      takeOptions(withTakes([{ id: "a", start: 0 }], []), "nobody"),
    ).toEqual([]);
  });

  it("copes with a lane playing nothing at all", () => {
    // Legal: swapping a take on leaves an empty arrangement behind, and swapping back must
    // still be offered — with no clip to draw and no start to seek to.
    const rows = takeOptions(
      withTakes([], [{ clips: [{ id: "b", start: 4 }] }]),
      "gtr",
    );
    expect(rows[1]).toEqual({ n: null, clip: "", startBeat: 0, events: 0 });
  });
});

describe("where the clip on screen sits", () => {
  it("answers the beat its lane places it at", () => {
    const p = withTakes([{ id: "pass3", start: 8 }], []);
    expect(placedBeat(p, "gtr", "pass3")).toBe(8);
  });

  it("answers null when the lane is not playing it — a take, or nothing at all", () => {
    // Null and not 0: bar one is a real answer, and "not placed" must not read as it.
    const p = withTakes(
      [{ id: "pass3", start: 8 }],
      [{ clips: [{ id: "pass1", start: 0 }] }],
    );
    expect(placedBeat(p, "gtr", "pass1")).toBeNull();
    expect(placedBeat(p, "nobody", "pass3")).toBeNull();
    expect(placedBeat(null, "gtr", "pass3")).toBeNull();
  });
});
