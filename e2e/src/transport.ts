// transport.ts — rolling a project's transport from its header, the way a person does.
// Play is pressed again until the clock moves: a Play that reaches the engine before the project does is lost (docs/e2e.md).
import { expect, type Locator, type Page } from "@playwright/test";

/** The header's position readout, `bar:beat·sub:tick`. */
export const clockOf = (page: Page): Locator =>
  page.getByRole("banner").getByText(/^\d+:\d\d·\d+:\d+/);

/** Presses Play until the clock leaves where it stood; returns that starting reading. */
export async function play(page: Page, timeoutMs = 20_000): Promise<string> {
  const clock = clockOf(page);
  const before = await clock.innerText();
  await expect(async () => {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(clock).not.toHaveText(before, { timeout: 2_500 });
  }).toPass({ timeout: timeoutMs });
  return before;
}
