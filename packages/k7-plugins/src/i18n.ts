// i18n.ts — the browser half's own catalogue, messages/<locale>.json compiled into src/paraglide/.
// It is handed no language: it reads k7's stored choice itself, on every message — ../docs/i18n.md.

import { getLocale } from "./paraglide/runtime.js";

/** Whether `n` takes the singular in the active language: French says "0 morceau", English "0 songs". */
export function isOne(n: number): boolean {
  return new Intl.PluralRules(getLocale()).select(n) === "one";
}
