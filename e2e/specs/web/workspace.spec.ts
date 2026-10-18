// workspace.spec.ts — what lives at the workspace root rather than in a project: TODOS.md and _references/.
// Both are seeded from e2e/fixtures, and read from inside any project of the workspace.
import { expect, test } from "@playwright/test";
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { watchPage } from "../../src/watch.ts";

test.beforeEach(async ({ page }) => {
  await page.goto(`/@local/${FIXTURES_WORKSPACE}/clip-lane.k7`);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
});

test("the Tasks panel lists TODOS.md", async ({ page }) => {
  const watch = watchPage(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("E2E open task")).toBeVisible();
  await expect(page.getByText("E2E done task")).toBeVisible();
  watch.assertClean();
});

test("the Reference tracks panel lists _references/", async ({ page }) => {
  const watch = watchPage(page);
  await page
    .getByRole("button", { name: "Reference tracks", exact: true })
    .click();
  await expect(page.getByText(/e2e-reference/)).toBeVisible();
  watch.assertClean();
});
