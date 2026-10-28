import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChordDiagram } from "./ChordDiagram";

const meta = {
  title: "Chords/ChordDiagram",
  component: ChordDiagram,
} satisfies Meta<typeof ChordDiagram>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Major: Story = { args: { symbol: "C" } };
export const MinorSeventh: Story = { args: { symbol: "Am7" } };
export const Slash: Story = { args: { symbol: "G/B" } };
export const Unknown: Story = { args: { symbol: "N.C." } };
