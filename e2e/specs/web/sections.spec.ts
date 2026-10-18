// sections.spec.ts — every entry of the home sidebar opens without a page error or a failing API call.
// The list is read off the sidebar itself, so a new section is covered the day it appears.
import { expect, test } from "@playwright/test";
import { watchPage } from "../../src/watch.ts";

test("every sidebar section opens cleanly", async ({ page }) => {
  await page.goto("/");
  const entries = page
    .getByRole("complementary")
    .getByRole("navigation")
    .getByRole("link");
  await expect(entries.first()).toBeVisible();
  const names = await entries.allInnerTexts();
  expect(names.length).toBeGreaterThan(5);
  for (const [i, name] of names.entries()) {
    await test.step(name, async () => {
      const watch = watchPage(page);
      await entries.nth(i).click();
      await page.waitForLoadState("networkidle");
      const path = new URL(page.url()).pathname;
      await page.screenshot({
        path: `test-results/sections/${i}-${path.replaceAll("/", "_")}.png`,
      });
      watch.assertClean();
    });
  }
});
