// midiActivity.ts — which MIDI devices just sent something, for the midi-in card's LED. ONE store for
// the page, since there is one Web MIDI recorder; every pane drawing a card passes this same one.
// Only channel messages light it: a keyboard's clock and active sensing would hold it on for good.

import type { MidiActivityStore } from "@studio/ui-chains-react";
import { matchMidiDevice } from "./webmidi";

// How long the LED stays lit after a device's last message.
const HOLD_MS = 120;

class MidiActivity implements MidiActivityStore {
  private lit = new Map<string, ReturnType<typeof setTimeout>>();
  private subs = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  // A card's label matches devices the way the recorder's does, "" being any.
  isLit(label: string): boolean {
    return matchMidiDevice(label, [...this.lit.keys()]).length > 0;
  }

  // A message from `device`: lit at once, dark HOLD_MS after the last one, and only the edges notify.
  ping(device: string): void {
    const held = this.lit.get(device);
    if (held) clearTimeout(held);
    this.lit.set(
      device,
      setTimeout(() => {
        this.lit.delete(device);
        this.notify();
      }, HOLD_MS),
    );
    if (!held) this.notify();
  }

  private notify(): void {
    for (const cb of this.subs) cb();
  }
}

export const midiActivity = new MidiActivity();
