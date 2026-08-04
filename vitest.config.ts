// Running `vitest run` from here — the obvious thing to do when you want the whole repo's tests at once — used
// to walk into `engine/moteur/build/`, where CMake has vendored Tracktion and JUCE. JUCE ships React demo apps,
// and their `App.test.js` are picked up as ours: two suites that fail to even parse, in a tree nobody wrote.
//
// `turbo run test` never saw this (it runs `vitest run` inside each package), which is why it went unnoticed.

import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Kept alongside the defaults, not replacing them — dropping `**/node_modules/**` here would be worse than
    // the problem being fixed.
    exclude: [
      ...defaultExclude,
      "engine/moteur/build/**",
      "engine/moteur/build-*/**",
    ],
  },
});
