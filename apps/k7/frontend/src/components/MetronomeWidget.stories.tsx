import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetronomeWidget } from "./MetronomeWidget";

// A panel of the song page's right rail, which is what positions it — hence the wrapper.
const meta = {
  title: "Songbook/MetronomeWidget",
  component: MetronomeWidget,
  render: (args) => (
    <div className="side-rail">
      <MetronomeWidget {...args} />
    </div>
  ),
} satisfies Meta<typeof MetronomeWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

// How every panel opens: folded, one click from its controls.
export const Folded: Story = { args: { open: false, onToggle: () => {} } };
export const Open: Story = { args: { open: true, onToggle: () => {} } };
