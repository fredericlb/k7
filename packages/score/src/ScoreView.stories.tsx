// The score viewer on a four-bar MusicXML written inline, so it draws without a backend or a song.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoreView } from "./ScoreView";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const url = URL.createObjectURL(new Blob([XML], { type: "application/xml" }));

const meta: Meta<typeof ScoreView> = {
  title: "k7/ScoreView",
  component: ScoreView,
  args: { url, transpose: 0, scale: 1 },
  argTypes: {
    transpose: { control: { type: "range", min: -12, max: 12, step: 1 } },
    scale: { control: { type: "range", min: 0.5, max: 2, step: 0.25 } },
  },
};
export default meta;

export const Default: StoryObj<typeof ScoreView> = {};

export const TransposedUpAFifth: StoryObj<typeof ScoreView> = {
  args: { transpose: 7 },
};
