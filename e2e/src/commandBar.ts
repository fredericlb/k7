// commandBar.ts — running a line from k7's command bar the way a person does: type it, pick its row.
// The bar is the combobox at the foot of a project page, named by its placeholder (apps/k7/frontend/docs/commandBar.md).
import { expect, type Locator, type Page } from "@playwright/test";

export const commandBar = (page: Page): Locator =>
  page.getByRole("combobox", { name: "what do you want to do?" });

/** Types `name` into the bar and picks the row whose command it is; for a command that takes no parameter. */
export async function runCommand(page: Page, name: string): Promise<void> {
  const bar = commandBar(page);
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
