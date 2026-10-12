import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// studio's Storybook: this repo's own components only — @frediverse/ui has one in commons.
const config: StorybookConfig = {
  stories: [
    "../packages/*/src/**/*.mdx",
    "../packages/*/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../apps/*/frontend/src/**/*.mdx",
    "../apps/*/frontend/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
  ],
  framework: "@storybook/react-vite",
  // alphaTab's font and soundfont, where ScoreView asks for them.
  staticDirs: [
    { from: "../node_modules/@coderline/alphatab/dist/font", to: "/font" },
    {
      from: "../node_modules/@coderline/alphatab/dist/soundfont",
      to: "/soundfont",
    },
  ],
  // A standalone root Vite pipeline, so Tailwind v4 is added here or no token compiles.
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = viteConfig.plugins ?? [];
    viteConfig.plugins.push(tailwindcss());

    // The automatic JSX runtime, or a workspace-symlinked component throws "React is not defined".
    viteConfig.esbuild = {
      ...(viteConfig.esbuild || {}),
      jsx: "automatic",
      jsxImportSource: "react",
    };
    return viteConfig;
  },
};

export default config;
