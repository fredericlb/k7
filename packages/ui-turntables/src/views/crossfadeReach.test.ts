// The crossfader has to end where a deck's waveform ends, and its reach is a COPY: three widths
// spelled as Tailwind classes in three other files, added up here as pixels. Nothing about that
// copy can fail loudly on its own — the bar simply stops short — so the classes are read back.
// See ../../docs/deskLayout.md and ../../docs/mix.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CROSSFADE_BLEED } from "./MixerColumn";

const read = (name: string): string =>
  readFileSync(join(import.meta.dirname, name), "utf8");

/** The pixels a Tailwind spacing class is worth — the scale is 4px a step. */
const px = (cls: string): number => Number(cls.split("-")[1]) * 4;

describe("how far the crossfader reaches past its column", () => {
  it("is the deck row's gap, the channel strip, and the deck section's gap", () => {
    // The deck ROW, in MixView: the space between the middle column and a deck.
    const row = read("MixView.tsx").match(/flex min-h-0 flex-1 (gap-\d+) p-4/);
    // The STRIP that stands between them…
    const strip = read("ChannelStrip.tsx").match(
      /className="flex (w-\d+) shrink-0 flex-col/,
    );
    // …and the gap inside a deck, between that strip and the column the waveform fills.
    const deck = read("DeckSide.tsx").match(
      /flex min-w-0 flex-1 (gap-\d+) rounded-lg/,
    );
    for (const [what, m] of [
      ["deck row", row],
      ["strip", strip],
      ["deck gap", deck],
    ] as const)
      expect(
        m,
        `${what}: the class this reach is built from has moved`,
      ).toBeTruthy();
    expect(px(row?.[1] ?? ""), "the deck row's gap").toBe(16);
    expect(px(strip?.[1] ?? ""), "the channel strip's width").toBe(64);
    expect(px(deck?.[1] ?? ""), "the deck section's gap").toBe(8);
    // …which is the number MixerColumn bleeds by, each side.
    expect(CROSSFADE_BLEED).toBe(
      px(row?.[1] ?? "") + px(strip?.[1] ?? "") + px(deck?.[1] ?? ""),
    );
  });
});
