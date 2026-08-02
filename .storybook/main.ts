import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// studio's Storybook: this repo's own shared package (@studio/ui-waveform), the
// app-local component libraries and the apps' stories. The design system itself
// (@frediverse/ui) has its own Storybook in the commons repo.
const config: StorybookConfig = {
  stories: [
    "../packages/*/src/**/*.mdx",
    "../packages/*/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../apps/*/packages/*/src/**/*.mdx",
    "../apps/*/packages/*/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
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
  // Serve radiok7's public assets (icons, etc.) some stories reference.
  staticDirs: ["../apps/radiok7/frontend/public"],
  // Standalone root Vite pipeline — the apps' own vite.config files aren't used
  // here. Add Tailwind v4 so the design tokens (theme.css) and the utility
  // classes used across the stories/components compile.
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = viteConfig.plugins ?? [];
    viteConfig.plugins.push(tailwindcss());

    // A component imported by bare specifier (e.g. `@radiok7/lyrics`) resolves
    // via the workspace symlink, so @vitejs/plugin-react skips it and Vite's own
    // esbuild transform handles it — and esbuild defaults to the *classic* JSX
    // runtime, which needs a global `React`. Since these components only import
    // the hooks they use, that throws "React is not defined" at render. Point
    // Vite's esbuild at the automatic runtime so JSX compiles to
    // react/jsx-runtime for those files, matching how each app builds them.
    viteConfig.esbuild = {
      ...(viteConfig.esbuild || {}),
      jsx: "automatic",
      jsxImportSource: "react",
    };
    return viteConfig;
  },
};

export default config;
