import type { Preview } from "@storybook/react-vite";
import "./preview.css";
// k7's legacy global stylesheet is plain CSS (no Tailwind directives) and
// styles its app-specific component stories (ChordDiagram, MetronomeWidget, …).
import "../apps/k7/frontend/src/styles.css";

const preview: Preview = {
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
