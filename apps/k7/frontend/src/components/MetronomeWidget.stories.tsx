import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetronomeWidget } from "./MetronomeWidget";

// Fixed to the viewport corner, so it renders in place whatever the layout around it.
const meta = {
  title: "Songbook/MetronomeWidget",
  component: MetronomeWidget,
} satisfies Meta<typeof MetronomeWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
