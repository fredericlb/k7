// smoke.spec.ts — the instance answers and the signed-in shell draws; the first spec any run must pass.
import { expect, test } from "@playwright/test";

test("the home page draws signed in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/home.png", fullPage: true });
  expect(errors).toEqual([]);
});
