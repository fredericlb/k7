// webmidi.ts — capture MIDI performance into a sequence via the Web MIDI API, in the
// BROWSER, because that is where the keyboard is (the engine's machine may be elsewhere;
// it records audio only). Notes are timed in SONG beats via a caller-supplied beatNow(),
// and committed through `sequence.recordNotes`. Raw timing — no quantize, deliberately.

// Web MIDI's types ship in the DOM lib; only `requestMIDIAccess` is behind a feature check, so narrow for that.
type MidiNavigator = Navigator & {
  requestMIDIAccess?: () => Promise<MIDIAccess>;
};

// A captured note in SONG beats; the caller subtracts the placement start to get the clip-local `t`.
export interface CapturedNote {
  t: number; // onset, song beats
  d: number; // duration, beats
  k: number; // MIDI key 0..127
  v: number; // velocity 0..1
}

// The shortest note we keep, so an instantaneous off still satisfies `#Note`'s `d > 0`.
const MIN_DURATION = 1 / 32;

export class MidiRecorder {
  private access?: MIDIAccess;
  private beatNow: () => number;
  private recording = false;
  // Open notes keyed by `${channel}:${key}` → their onset beat + velocity.
  private open = new Map<string, { start: number; v: number }>();
  private notes: CapturedNote[] = [];

  constructor(beatNow: () => number) {
    this.beatNow = beatNow;
  }

  // Ask for MIDI access and attach to every input; false when there is none, and the caller records no MIDI.
  async init(): Promise<boolean> {
    const nav = navigator as MidiNavigator;
    if (!nav.requestMIDIAccess) return false;
    try {
      this.access = await nav.requestMIDIAccess();
    } catch {
      return false;
    }
    this.attach();
    // Inputs can appear/disappear (a keyboard plugged in mid-session); re-attach on change.
    this.access.onstatechange = () => this.attach();
    return true;
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values())
      input.onmidimessage = (e) => this.onMessage(e);
  }

  // Begin a take: clear any carry-over and start pairing events.
  start(): void {
    this.notes = [];
    this.open.clear();
    this.recording = true;
  }

  // End a take: any key still held is closed at the current beat, so a sustained note lands with a real length.
  stop(): CapturedNote[] {
    this.recording = false;
    const now = this.beatNow();
    for (const [key, o] of this.open) {
      const k = Number(key.split(":")[1]);
      this.notes.push({
        t: o.start,
        d: Math.max(MIN_DURATION, now - o.start),
        k,
        v: o.v,
      });
    }
    this.open.clear();
    return this.notes;
  }

  // Detach from every input and drop the access. Safe to call more than once.
  dispose(): void {
    if (this.access) {
      for (const input of this.access.inputs.values())
        input.onmidimessage = null;
      this.access.onstatechange = null;
    }
    this.access = undefined;
    this.recording = false;
    this.open.clear();
  }

  private onMessage(e: MIDIMessageEvent): void {
    if (!this.recording || !e.data || e.data.length < 3) return;
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    const ch = status & 0x0f;
    const beat = this.beatNow();
    // Note-on with velocity 0 is a note-off by convention.
    if (cmd === 0x90 && d2 > 0) {
      this.open.set(`${ch}:${d1}`, { start: beat, v: d2 / 127 });
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      const key = `${ch}:${d1}`;
      const o = this.open.get(key);
      if (o) {
        this.notes.push({
          t: o.start,
          d: Math.max(MIN_DURATION, beat - o.start),
          k: d1,
          v: o.v,
        });
        this.open.delete(key);
      }
    }
  }
}
