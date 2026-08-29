// A config of its own for ONE reason: these tests each point `$STUDIO_HOME` at a temp dir of
// their own, and the default pool runs test FILES concurrently in a single process — where
// `process.env` is shared. One file's `beforeEach` then redirects another file's writes
// mid-test, which showed up as a merged-log test failing about one run in six.
//
// `forks` gives each file its own process, so the env var is the isolation it looks like.
// The cost is process startup per file; the suite is ~4s either way.

import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.ts";

export default mergeConfig(
  root,
  defineConfig({
    test: {
      pool: "forks",
    },
  }),
);
