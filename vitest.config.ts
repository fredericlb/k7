// Running `vitest run` from here — the obvious thing to do when you want the whole repo's tests at once — used
// to walk into `engine/st0-engine/build/`, where CMake has vendored Tracktion and JUCE. JUCE ships React demo apps,
// and their `App.test.js` are picked up as ours: two suites that fail to even parse, in a tree nobody wrote.
//
// `turbo run test` never saw this (it runs `vitest run` inside each package), which is why it went unnoticed.

import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Kept ALONGSIDE the defaults: dropping `**/node_modules/**` would be worse than the problem.
    exclude: [
      ...defaultExclude,
      "engine/st0-engine/build/**",
      "engine/st0-engine/build-*/**",
      // Every branch ever worked on is checked out under here — see docs/tests.md.
      ".claude/worktrees/**",
    ],
    // Most tests here touch a real disk, and turbo runs them 30-wide — docs/tests.md.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
