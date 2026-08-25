// The two knob columns of a deck, at every rung of the size ladder.
//
// They exist because nothing here mounts a component (see st0's AGENTS.md), so the only way to
// look at a strip was to start the engine, the file service and the editor and open a set. What
// has to be SEEN rather than asserted: that the glyph and the word fit on one 9 px line at every
// rung, and that the four stems read as a square rather than as a list.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { STEMS } from "@studio/song-schema/stems";
import { useState } from "react";
import type { StripLayout } from "../deskLayout";
import { ChannelStrip, StemStrip } from "./ChannelStrip";

const RUNGS: StripLayout[] = [
  { knob: 36, filter: 44, readout: true, gap: 12 },
  { knob: 32, filter: 40, readout: true, gap: 8 },
  { knob: 28, filter: 34, readout: false, gap: 6 },
  { knob: 24, filter: 28, readout: false, gap: 4 },
  { knob: 20, filter: 24, readout: false, gap: 2 },
];

function Both({ layout }: { layout: StripLayout }) {
  const [eq, setEq] = useState<Record<string, number>>({ eqLow: 4 });
  const [stems, setStems] = useState<Record<string, number>>({ drums: 0.4 });
  const [filter, setFilter] = useState(0);
  return (
    <div className="flex items-start gap-4">
      <StemStrip
        stems={stems}
        live
        ready
        prep={undefined}
        layout={layout}
        onStem={(s, v) => setStems((p) => ({ ...p, [s]: v }))}
      />
      <ChannelStrip
        eq={eq}
        eqLive
        filter={filter}
        filterLive
        layout={layout}
        onEq={(b, v) => setEq((p) => ({ ...p, [b]: v }))}
        onFilter={setFilter}
      />
    </div>
  );
}

const meta = {
  title: "Desk/Knobs",
  component: Both,
} satisfies Meta<typeof Both>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Every rung side by side: the one thing to look for is a label wrapping or a glyph crowding it. */
export const EveryRung: Story = {
  args: { layout: RUNGS[0] },
  render: () => (
    <div className="flex items-start gap-8 bg-background p-4 text-foreground">
      {RUNGS.map((l) => (
        <div key={l.knob} className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {l.knob}px
          </span>
          <Both layout={l} />
        </div>
      ))}
    </div>
  ),
};

/** The greyed state, since a record nobody separated is what a deck shows most of the evening. */
export const NotSeparated: Story = {
  args: { layout: RUNGS[0] },
  render: () => (
    <div className="bg-background p-4 text-foreground">
      <StemStrip
        stems={Object.fromEntries(STEMS.map((s) => [s, 1]))}
        live
        ready={false}
        prep={undefined}
        layout={RUNGS[0]}
        onStem={() => {}}
      />
    </div>
  ),
};
