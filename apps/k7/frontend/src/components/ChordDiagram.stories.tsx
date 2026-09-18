import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChordDiagram } from "./ChordDiagram";
import { ChordsPanel } from "./ChordsPanel";

const meta = {
  title: "Songbook/ChordDiagram",
  component: ChordDiagram,
} satisfies Meta<typeof ChordDiagram>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Major: Story = { args: { symbol: "C" } };
export const MinorSeventh: Story = { args: { symbol: "Am7" } };
export const Slash: Story = { args: { symbol: "G/B" } };
export const Unknown: Story = { args: { symbol: "N.C." } };

// In the app it is a panel of the page's right rail, which is what positions it.
export const Panel: StoryObj<typeof ChordsPanel> = {
  render: () => (
    <div className="side-rail">
      <ChordsPanel
        chords={["C", "G", "Am", "F", "Dm7", "E7"]}
        selected="Am"
        open
        onToggle={() => {}}
      />
    </div>
  ),
};

// More than 6 chords → `three-col` class (widens to 3 per row on ≥1360px screens).
export const PanelManyChords: StoryObj<typeof ChordsPanel> = {
  render: () => (
    <div className="side-rail">
      <ChordsPanel
        chords={["C", "G", "Am", "F", "Dm7", "E7", "Bb", "D", "Em", "A7"]}
        selected={null}
        open
        onToggle={() => {}}
      />
    </div>
  ),
};
