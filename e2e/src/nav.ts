// nav.ts — a header control by its name, wherever the width put it: in the header, or in k7's Menu on a phone.
// On a phone the panes become menu items and the header's tools move into the same menu (apps/k7/frontend/src/components/MobileChrome.tsx).
import type { Locator, Page } from "@playwright/test";

// useIsMobile's query (apps/k7/frontend/src/useIsMobile.ts); a desktop header has a Menu button too, so the button alone says nothing.
const MOBILE_QUERY = "(max-width: 820px), (max-height: 520px)";

/** True when the header has folded into the Menu. */
export async function folded(page: Page): Promise<boolean> {
  return page.evaluate((q) => {
    const win = globalThis as unknown as {
      matchMedia(query: string): { matches: boolean };
    };
    return win.matchMedia(q).matches;
  }, MOBILE_QUERY);
}

/** Opens the Menu when the header has folded, so what it holds can be found. */
async function openNav(page: Page): Promise<void> {
  if (!(await folded(page))) return;
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
}

/** The tempo readout `<n> bpm`: in the footer, or on a phone in the Info popover it moved to (docs/shell.md). */
export async function tempoReadout(page: Page, n: number): Promise<Locator> {
  const name = { name: `${n} bpm` };
  if (!(await folded(page)))
    return page.getByRole("contentinfo").getByRole("button", name);
  const info = page.getByRole("button", { name: "Project and engine" });
  if ((await info.getAttribute("aria-expanded")) !== "true") await info.click();
  return page
    .getByRole("dialog", { name: "Project and engine" })
    .getByRole("button", name);
}

/** A pane or header tool named `name`: a header button, or the Menu's item or button once it is open. */
export async function navControl(page: Page, name: string): Promise<Locator> {
  await openNav(page);
  const exact = { name, exact: true };
  return page
    .getByRole("button", exact)
    .or(page.getByRole("menu").getByRole("menuitem", exact));
}
