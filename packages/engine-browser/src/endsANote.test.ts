// What a played MIDI message may NOT lose while the engine link is down: whatever lets a sound go.

import { describe, expect, it } from "vitest";
import { endsANote } from "./engine.ts";

describe("endsANote", () => {
  it("keeps note-offs, in both spellings", () => {
    expect(endsANote([0x80, 60, 64])).toBe(true);
    expect(endsANote([0x93, 60, 0])).toBe(true);
  });
  it("keeps a sustain pedal released and all-notes-off", () => {
    expect(endsANote([0xb0, 64, 0])).toBe(true);
    expect(endsANote([0xb0, 123, 0])).toBe(true);
  });
  // A note played during a blink is dropped, not heard thirty seconds later.
  it("drops what starts or shapes a sound", () => {
    expect(endsANote([0x90, 60, 100])).toBe(false);
    expect(endsANote([0xb0, 64, 127])).toBe(false);
    expect(endsANote([0xb0, 1, 40])).toBe(false);
    expect(endsANote([0xe0, 0, 64])).toBe(false);
  });
});
