// editor.ts — the k7x editor's textbox and its vim mode, as assistive technology reads them.
// The textbox is named after its file, `<path> — editor`; vim mode adds a status named "vim" (packages/ui-editor/docs/a11y.md).
import type { Locator, Page } from "@playwright/test";

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The editor showing `file`, matched on the path's end so a project prefix does not matter. */
export const editorText = (page: Page, file: string): Locator =>
  page.getByRole("textbox", {
    name: new RegExp(`(^|/)${escaped(file)} — editor$`),
  });

/** The vim mode panel under the text: NORMAL, INSERT… */
export const vimStatus = (page: Page): Locator =>
  page.getByRole("status", { name: "vim", exact: true });

/** Whether the account's editor is in vim mode, read once an editor is open. */
export async function inVim(page: Page): Promise<boolean> {
  return (await vimStatus(page).count()) > 0;
}
