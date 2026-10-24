// transport.ts — rolling a project's transport from its bar at the foot, the way a person does.
// Play is pressed ONCE, as soon as it is offered: it reads "loading the project" until the engine holds it (docs/e2e.md).
import { expect, type Locator, type Page } from "@playwright/test";

/** The project bar, where the transport's buttons and its clock are. */
export const transportBar = (page: Page): Locator =>
  page.getByRole("region", { name: "Transport", exact: true });

/** The bar's position readout, `bar:beat·sub:tick`. */
export const clockOf = (page: Page): Locator =>
  transportBar(page).getByText(/^\d+:\d\d·\d+:\d+/);

/** Presses Play the moment it is enabled and checks the clock leaves where it stood; returns that reading. */
export async function play(page: Page, timeoutMs = 30_000): Promise<string> {
  const clock = clockOf(page);
  const button = transportBar(page).getByRole("button", {
    name: "Play",
    exact: true,
  });
  await expect(button).toBeEnabled({ timeout: timeoutMs });
  const before = await clock.innerText();
  await button.click();
  // A picture project on a phone has taken more than 5 s to move its clock on the first play.
  await expect(clock).not.toHaveText(before, { timeout: 15_000 });
  return before;
}
