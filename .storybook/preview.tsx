import type { Preview } from "@storybook/react-vite";
import "./preview.css";
// k7's legacy global stylesheet: plain CSS, and what its own component stories are styled by.
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
