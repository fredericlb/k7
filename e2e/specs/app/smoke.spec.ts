// smoke.spec.ts — the instance answers and the signed-in shell draws; the first spec any run must pass.
import { expect, test } from "../../src/target.ts";

test("the home page draws signed in", async ({ k7 }) => {
  const errors: string[] = [];
  const page = await k7.open("/");
  page.on("pageerror", (err) => errors.push(err.message));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: `test-results/${k7.target}-home.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
