// seed.setup.ts — rewrites the E2E workspace from e2e/fixtures before the specs that open those projects.
import { test as setup } from "@playwright/test";
import { FileService } from "../src/files.ts";
import { seedFixtures } from "../src/fixtures.ts";
import { AUTH_STATE } from "../src/paths.ts";

setup.use({ storageState: AUTH_STATE });

setup("seed the fixture workspace", async ({ request }) => {
  setup.setTimeout(120_000);
  await seedFixtures(await FileService.connect(request));
});
