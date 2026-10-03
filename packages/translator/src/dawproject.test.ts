// The `.dawproject` readings that fail SILENTLY when wrong — the mapper's first suite, and it
// starts where a real Bitwig export was losing music: a clip whose content is written once and
// PLACED several times carries nothing but a `reference`, and was dropped with it.
//
// The archive is built here rather than committed: a zip in git is a binary nobody can read a diff
// of, and what is under test is the XML. See docs/import.md.

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDawproject } from "./dawproject";

/** The smallest document that puts `body` on one track's timeline. */
function archive(body: string, structure = ""): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
  <Transport><Tempo value="120" unit="bpm" /><TimeSignature numerator="4" denominator="4" /></Transport>
  <Structure>
    <Track id="t1" name="drums" contentType="notes"><Channel id="c1" role="regular" /></Track>
    ${structure}
  </Structure>
  <Arrangement>
    <Lanes timeUnit="beats">
      <Lanes timeUnit="beats" track="t1">
        <Clips>${body}</Clips>
      </Lanes>
    </Lanes>
  </Arrangement>
</Project>`;
  return zipSync({ "project.xml": new TextEncoder().encode(xml) });
}

const parse = (body: string, structure = "") =>
  parseDawproject(archive(body, structure), "t");

/** The notes of every MIDI clip on the one track, in the order they were collected. */
const midi = (r: ReturnType<typeof parse>) =>
  (r.song.tracks[0]?.clips ?? []).filter((c) => c.type === "midi");

describe("a container plays a window of its children", () => {
  const note = `<Notes><Note time="0.0" duration="1.0" channel="0" key="60" vel="0.8" /></Notes>`;

  it("drops a child that falls outside the window, rather than flattening it to nothing", () => {
    // The container plays beats 0..8 of its own timeline; the second child sits at 16 and is not
    // played by THIS placement. Emitted anyway it became a zero-length clip on the lane, and a
    // pile of those reads as overlaps the source project never had.
    const r = parse(
      `<Clip time="0.0" duration="8.0" playStart="0.0"><Clips>
         <Clip time="0.0" duration="4.0">${note}</Clip>
         <Clip time="16.0" duration="4.0">${note}</Clip>
       </Clips></Clip>`,
    );
    const clips = r.song.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBe(0);
    expect(clips[0].length).toBe(4);
  });

  it("keeps a child the window CUTS, at the length it actually plays", () => {
    // Half in: the placement is the overlap, which is what the container plays of it.
    const r = parse(
      `<Clip time="0.0" duration="6.0" playStart="0.0"><Clips>
         <Clip time="4.0" duration="8.0">${note}</Clip>
       </Clips></Clip>`,
    );
    const [only] = r.song.tracks[0]?.clips ?? [];
    expect(only.start).toBe(4);
    expect(only.length).toBe(2);
  });

  it("starts a cut child where the window starts IN it, not at its own top", () => {
    // Bitwig's audio shape: a container at 20 playing from 20 of a take placed at 0 — the take must play from 20.
    const r = parse(
      `<Clip time="20.0" duration="36.0" playStart="20.0"><Clips>
         <Clip time="0.0" duration="256.0" playStart="0.0">${note}</Clip>
       </Clips></Clip>`,
    );
    const [only] = r.song.tracks[0]?.clips ?? [];
    expect(only.start).toBe(20);
    expect(only.length).toBe(36);
    expect(only.offset).toBe(20);
  });

  it("adds the cut to the child's own in-point", () => {
    // Container plays from 8 of a child placed at 3 that itself starts 1 beat in: 1 + (8 - 3).
    const r = parse(
      `<Clip time="8.0" duration="8.0" playStart="8.0"><Clips>
         <Clip time="3.0" duration="30.0" playStart="1.0">${note}</Clip>
       </Clips></Clip>`,
    );
    const [only] = r.song.tracks[0]?.clips ?? [];
    expect(only.start).toBe(8);
    expect(only.offset).toBe(6);
  });

  it("carries a disabled clip as disabled, a disabled container's children included", () => {
    const r = parse(
      `<Clip time="0.0" duration="4.0" enable="false">${note}</Clip>
       <Clip time="4.0" duration="4.0" playStart="0.0" enable="false"><Clips>
         <Clip time="0.0" duration="4.0">${note}</Clip>
       </Clips></Clip>
       <Clip time="8.0" duration="4.0">${note}</Clip>`,
    );
    expect(midi(r).map((c) => c.disabled)).toEqual([true, true, undefined]);
  });

  it("drops a clip the source gave no duration at all", () => {
    // Nothing to play, container or not — and nothing to warn about either.
    const r = parse(`<Clip time="4.0" duration="0.0">${note}</Clip>`);
    expect(r.song.tracks[0]?.clips ?? []).toHaveLength(0);
    expect(r.warnings).toEqual([]);
  });
});

describe("a clip whose content is written elsewhere", () => {
  const notes = `<Notes id="n1">
      <Note time="0.0" duration="0.5" channel="0" key="36" vel="0.8" />
      <Note time="1.0" duration="0.5" channel="0" key="38" vel="0.6" />
    </Notes>`;

  it("reads the notes through the reference", () => {
    const r =
      parse(`<Clip time="8.0" duration="4.0" name="Backbeat" reference="n1" />
      <Clip time="0.0" duration="4.0">${notes}</Clip>`);
    expect(r.warnings).toEqual([]);
    // Two clips: the one that spelled its notes out, and the one that pointed at them.
    expect(midi(r)).toHaveLength(2);
    expect(r.stats.notes).toBe(4);
  });

  it("gives each placement its own position, and a copy of the notes", () => {
    // The reference shares CONTENT; where it plays and how long for is the placement's own.
    const r = parse(
      `<Clip time="0.0" duration="4.0">${notes}</Clip>
       <Clip time="16.0" duration="8.0" reference="n1" />`,
    );
    const [first, second] = midi(r);
    expect(first.start).toBe(0);
    expect(second.start).toBe(16);
    expect(second.length).toBe(8);
    expect(second.notes?.map((n) => n.key)).toEqual([36, 38]);
    // A copy, not the same array: an edit to one placement must not reach the other.
    expect(second.notes).not.toBe(first.notes);
  });

  it("reads AUDIO through a reference too, not only notes", () => {
    const r = parse(
      `<Clip time="0.0" duration="4.0"><Audio id="a1" sampleRate="48000" duration="2.0">
         <File path="audio/kick.wav" /></Audio></Clip>
       <Clip time="8.0" duration="4.0" reference="a1" />`,
    );
    const audio = (r.song.tracks[0]?.clips ?? []).filter(
      (c) => c.type === "audio",
    );
    expect(audio).toHaveLength(2);
    expect(audio[1].source).toBe("audio/kick.wav");
    expect(audio[1].start).toBe(8);
  });

  // …and the two ways a clip legitimately has nothing, which must still be reported.
  it("says so when the id it names is nowhere in the file", () => {
    const r = parse(
      `<Clip time="4.0" duration="4.0" name="Ghost" reference="gone" />`,
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('"Ghost"');
    expect(r.warnings[0]).toContain('id "gone"');
    expect(r.warnings[0]).toContain("this file does not define");
  });

  it("keeps the old sentence for a clip that references nothing at all", () => {
    const r = parse(`<Clip time="4.0" duration="4.0" name="Empty" />`);
    expect(r.warnings[0]).toContain("no audio/notes/nested clips");
    expect(r.warnings[0]).toContain("children: none");
  });

  it("refuses to read a reference that names something which is not content", () => {
    // `c1` is a Channel: resolvable, and not a clip's content. Dropped, and said out loud.
    const r = parse(
      `<Clip time="4.0" duration="4.0" name="Chan" reference="c1" />`,
    );
    expect(r.warnings).toHaveLength(1);
    // …and it says WHICH of the two it is, since "not defined" would be a lie about this file.
    expect(r.warnings[0]).toContain("is a <Channel> and not clip content");
  });
});
