import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetronomeWidget } from "./MetronomeWidget";

// The widget is fixed to the viewport corner, so it renders in place regardless
// of layout. Click ♩ to expand; Start plays the click track.
const meta = {
  title: "Songbook/MetronomeWidget",
  component: MetronomeWidget,
} satisfies Meta<typeof MetronomeWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
