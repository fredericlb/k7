// project.spec.ts — each seeded example project opens into its editor on the machine's engine.
// It needs an engine the account can reach; without one the picker is all a project shows (docs/e2e.md).
import { expect, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const EXAMPLES = [
  "crossfade-demo",
  "node-demo",
  "rack-demo",
  "synth-demo",
  "video-demo",
];

for (const name of EXAMPLES) {
  test(`${name} opens on the engine`, async ({ k7 }) => {
    const home = await k7.open("/");
    // The app cancels the link's navigation and opens a tab instead, so the click must not wait for one.
    await home
      .getByRole("link", { name: new RegExp(`\\b${name}\\b`) })
      .click({ noWaitAfter: true });
    const page = await k7.landed(home, new RegExp(`/@local/Examples/${name}`));
    const watch = watchPage(page);
    await expect(
      page.getByRole("img", { name: "engine connected" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: `test-results/projects/${k7.target}-${name}.png`,
    });
    watch.assertClean();
  });
}
