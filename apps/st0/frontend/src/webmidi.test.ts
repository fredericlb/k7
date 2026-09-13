import { describe, expect, it } from "vitest";
import { type MidiInputInfo, MidiRecorder } from "./webmidi";

// The recorder's INPUT SELECTION — the transport's device picker decides which keyboard feeds a
// take, and the default (every input) is what a one-keyboard rig relies on. No real MIDI here:
// the fake access is injected straight into the instance, `init()`'s navigator round trip
// being exactly what a browser has and a test does not.

const NOTE_ON = (key: number, velocity: number) => [0x90, key, velocity];
const NOTE_OFF = (key: number) => [0x80, key, 0];

function recorderWithAccess(inputs: [string, string][]) {
  const beat = { now: 0 };
  const rec = new MidiRecorder(() => beat.now);
  const handlers = new Map<string, ((e: unknown) => void) | null>();
  const ports = new Map<
    string,
    { id: string; name: string; onmidimessage: unknown }
  >();
  for (const [id, name] of inputs) {
    const input: { id: string; name: string; onmidimessage: unknown } = {
      id,
      name,
      onmidimessage: null,
    };
    Object.defineProperty(input, "onmidimessage", {
      get: () => handlers.get(id) ?? null,
      set: (h) => handlers.set(id, h as (e: unknown) => void),
    });
    ports.set(id, input);
  }
  const access = {
    inputs: { values: () => ports.values() },
    onstatechange: null,
  };
  (rec as unknown as { access?: unknown }).access = access;
  return {
    rec,
    beat,
    listInputs: (): MidiInputInfo[] => rec.listInputs(),
    send: (id: string, data: number[]) =>
      handlers.get(id)?.({ data: Uint8Array.from(data) }),
  };
}

describe("MidiRecorder's input selection", () => {
  it("asks for nothing when the browser has no Web MIDI at all", async () => {
    // Node's navigator answers like a browser without the API, so this is the real guard.
    const rec = new MidiRecorder(() => 0);
    await expect(rec.init()).resolves.toBe(false);
    expect(rec.listInputs()).toEqual([]);
  });

  it("lists the plugged-in inputs by name", () => {
    const r = recorderWithAccess([
      ["in-1", "MiniLab"],
      ["in-2", ""],
    ]);
    expect(r.listInputs()).toEqual([
      { id: "in-1", name: "MiniLab" },
      { id: "in-2", name: "in-2" },
    ]);
  });

  it("captures every input until one is picked", () => {
    const r = recorderWithAccess([
      ["in-1", "MiniLab"],
      ["in-2", "Pads"],
    ]);
    r.rec.selectInput(null); // the picker's default, so attach runs
    expect(r.rec.selectedInput).toBeNull();
    r.rec.start();
    r.beat.now = 1;
    r.send("in-1", NOTE_ON(60, 100));
    r.send("in-2", NOTE_ON(62, 64));
    r.beat.now = 3;
    r.send("in-1", NOTE_OFF(60));
    r.send("in-2", NOTE_OFF(62));
    expect(r.rec.stop()).toEqual([
      { t: 1, d: 2, k: 60, v: 100 / 127 },
      { t: 1, d: 2, k: 62, v: 64 / 127 },
    ]);
  });

  it("captures only the picked input, and the picker's check reads back", () => {
    const r = recorderWithAccess([
      ["in-1", "MiniLab"],
      ["in-2", "Pads"],
    ]);
    r.rec.selectInput("in-2");
    expect(r.rec.selectedInput).toBe("in-2");
    r.rec.start();
    r.beat.now = 1;
    r.send("in-1", NOTE_ON(60, 100));
    r.send("in-2", NOTE_ON(62, 64));
    r.beat.now = 3;
    r.send("in-1", NOTE_OFF(60));
    r.send("in-2", NOTE_OFF(62));
    expect(r.rec.stop()).toEqual([{ t: 1, d: 2, k: 62, v: 64 / 127 }]);
  });

  it("closes a key still held at the stop beat, on the picked input", () => {
    const r = recorderWithAccess([["in-1", "MiniLab"]]);
    r.rec.selectInput("in-1");
    r.rec.start();
    r.beat.now = 2;
    r.send("in-1", NOTE_ON(48, 127));
    r.beat.now = 2.5;
    const notes = r.rec.stop();
    expect(notes).toEqual([{ t: 2, d: 0.5, k: 48, v: 1 }]);
  });

  it("init() is idempotent once access is held, whatever the navigator says", async () => {
    const r = recorderWithAccess([["in-1", "MiniLab"]]);
    // Access was injected above, so the request must be skipped — Node has no Web MIDI to grant.
    await expect(r.rec.init()).resolves.toBe(true);
  });

  it("switching selection back to null listens to every input again", () => {
    const r = recorderWithAccess([
      ["in-1", "MiniLab"],
      ["in-2", "Pads"],
    ]);
    r.rec.selectInput("in-1");
    r.rec.selectInput(null);
    r.rec.start();
    r.beat.now = 1;
    r.send("in-1", NOTE_ON(60, 100));
    r.send("in-2", NOTE_ON(62, 64));
    r.beat.now = 3;
    r.send("in-1", NOTE_OFF(60));
    r.send("in-2", NOTE_OFF(62));
    expect(r.rec.stop()).toHaveLength(2);
  });
});
