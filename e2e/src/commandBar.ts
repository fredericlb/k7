// commandBar.ts — running a line from k7's command bar the way a person does: type it, pick its row.
// The bar is a combobox named "Command", floating once summoned (apps/k7/frontend/docs/commandBar.md).
import { expect, type Locator, type Page } from "@playwright/test";
import { folded, navControl } from "./nav.ts";

export const commandBar = (page: Page): Locator =>
  page.getByRole("combobox", { name: "Command" });

/** The bar, summoned by Ctrl/⌘+Shift+P, or from the Menu's Commands item on a phone. */
export async function openCommandBar(page: Page): Promise<Locator> {
  const bar = commandBar(page);
  if (await bar.isVisible()) return bar;
  if (!(await folded(page))) {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    return bar;
  }
  // A phone's toast sits where the popin's suggestions open, and covers them until it is closed.
  for (const close of await page
    .getByRole("button", { name: "Dismiss", exact: true })
    .all())
    if (await close.isVisible()) await close.click();
  if (!(await bar.isVisible()))
    await (await navControl(page, "Commands")).click();
  return bar;
}

/** Types `name` into the bar and picks the row whose command it is; for a command that takes no parameter. */
export async function runCommand(page: Page, name: string): Promise<void> {
  const bar = await openCommandBar(page);
  await bar.click();
  await bar.fill(name);
  // A row reads "<sentence> <name>", so its accessible name ends with the command's.
  const row = page
    .getByRole("listbox", { name: "Commands" })
    .getByRole("option", { name: new RegExp(` ${name}$`) });
  await expect(row).toBeVisible();
  await row.click();
}

/** The status line in the page's footer, where a command says what it did. */
export const statusLine = (page: Page): Locator =>
  page.getByRole("contentinfo").getByRole("status").first();

/** Expects the status line to read `text`; a phone draws none, so there the caller's disk check stands alone. */
export async function expectStatus(
  page: Page,
  text: string | RegExp,
): Promise<void> {
  if (await folded(page)) return;
  await expect(statusLine(page)).toHaveText(text);
}
