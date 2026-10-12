import type { Preview } from "@storybook/react-vite";
import "./preview.css";
// The rehearsal pages' stylesheet, scoped under .rehearsal-root: the decorator below wears it.
import "../packages/ui-rehearsal/src/styles/index.css";

const preview: Preview = {
  // Every story inside the rehearsal wrapper: outside it, that stylesheet styles nothing.
  decorators: [
    (Story) => (
      <div className="rehearsal-root">
        <Story />
      </div>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' shows a11y violations in the test UI only; 'error' fails CI.
      test: "todo",
    },
  },
};

export default preview;
