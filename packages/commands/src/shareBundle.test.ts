import { describe, expect, it } from "vitest";
import { stemSlots } from "./shareBundle";

/**
 * The engine names a stem by its TRACK's name, and a track name is a human string — it can hold a
 * slash, a quote, or the same characters as its neighbour. Those names would become URL segments
 * of a PUBLIC link, so none of them is used as one: every stem gets a slot id we choose, and the
 * human name stays a label.
 *
 * This is the one place the engine's output reaches a path, and it is where the traversal bug
 * would be.
 */

const track = (id: string, name?: string) => ({ id, name });
const stem = (name: string) => ({ name, file: `${name}.wav` });

describe("giving each stem a slot", () => {
  it("names the file after the slot, never after the track", () => {
    const out = stemSlots([track("t1", "Basse")], [stem("Basse")]);
    expect(out[0].file).toBe("audio/s0.wav");
    expect(out[0].id).toBe("s0");
  });

  it("keeps the human name as a LABEL, whatever it holds", () => {
    const nasty = 'Gtr/L "wide" ../..';
    const out = stemSlots([track("t1", nasty)], [stem(nasty)]);
    expect(out[0].name).toBe(nasty);
    // …and nothing of it reaches the path. `buildShareBundle` may later swap the extension for
    // `.mp3`; what it never does is take a character of this from the track's name.
    expect(out[0].file).toBe("audio/s0.wav");
  });

  it("points a stem back at its track when the name identifies one", () => {
    const out = stemSlots(
      [track("t1", "Basse"), track("t2", "Voix")],
      [stem("Voix"), stem("Basse")],
    );
    expect(out.map((s) => s.track)).toEqual(["t2", "t1"]);
  });

  it("points at NO track when two share a name, rather than guessing", () => {
    // A guess here would light the wrong lane's mute button on the viewer.
    const out = stemSlots(
      [track("t1", "Gtr"), track("t2", "Gtr")],
      [stem("Gtr")],
    );
    expect(out[0].track).toBe("");
    expect(out[0].id).toBe("s0"); // …and it still has a slot, so it still plays
  });

  it("points at no track for a name no track carries", () => {
    expect(stemSlots([track("t1", "Basse")], [stem("Ghost")])[0].track).toBe(
      "",
    );
  });

  it("falls back to the id for a track that states no name", () => {
    expect(stemSlots([track("drums")], [stem("drums")])[0].track).toBe("drums");
  });

  it("gives every stem a DISTINCT slot, which is what the URLs rest on", () => {
    const out = stemSlots(
      [track("t1", "Gtr"), track("t2", "Gtr")],
      [stem("Gtr"), stem("Gtr"), stem("Gtr")],
    );
    expect(new Set(out.map((s) => s.file)).size).toBe(3);
  });

  it("answers nothing for a render with no stems", () => {
    expect(stemSlots([track("t1")], [])).toEqual([]);
  });
});
