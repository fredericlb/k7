// project.spec.ts — each seeded example project opens into its editor on the machine's engine.
// It needs an engine listed at the instance; without one the picker is all a project shows (docs/e2e.md).
import { expect, test } from "@playwright/test";
import { watchPage } from "../../src/watch.ts";

const EXAMPLES = [
  "crossfade-demo",
  "node-demo",
  "rack-demo",
  "synth-demo",
  "video-demo",
];

for (const name of EXAMPLES) {
  test(`${name} opens on the engine`, async ({ page }) => {
    const watch = watchPage(page);
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(`^${name}\\b`) }).click();
    await expect(page).toHaveURL(new RegExp(`/@local/Examples/${name}`));
    await expect(
      page.getByRole("img", { name: "engine connected" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: `test-results/projects/${name}.png` });
    watch.assertClean();
  });
}
