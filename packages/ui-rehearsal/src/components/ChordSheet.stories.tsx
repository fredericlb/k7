import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChordSheet } from "@studio/lyrics";

const meta = {
  title: "Songbook/ChordSheet",
  component: ChordSheet,
  argTypes: {
    transpose: { control: { type: "range", min: -6, max: 6, step: 1 } },
  },
} satisfies Meta<typeof ChordSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const CHORDS_ABOVE = `[Verse 1]
C            G          Am         F
Twinkle twinkle little star
C          G        C
How I wonder what you are

[Chorus]
F        C       G        C
Up above the world so high`;

const INLINE = `[Intro]
[Am]Hello [C]darkness my [G]old friend
[Am]I've come to [C]talk with you a[G]gain

(Chorus)
Because a [F]vision softly [C]creeping`;

export const ChordsAboveLyrics: Story = {
  args: { text: CHORDS_ABOVE, transpose: 0 },
};

export const InlineChords: Story = {
  args: { text: INLINE, transpose: 0 },
};

export const Transposed: Story = {
  args: { text: CHORDS_ABOVE, transpose: 2 },
};
