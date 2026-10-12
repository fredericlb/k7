// i18n.ts — the rehearsal pages' own catalogue, messages/<locale>.json compiled into src/paraglide/.
// The HOST owns the language: it calls `followLocale` with its own, and both runtimes share the
// same localStorage key, so a reload agrees too.

import * as runtime from "./paraglide/runtime.js";

/** Switch this catalogue to the host's language; one it was not compiled for falls back to the base. */
export function followLocale(locale: string): void {
  const next = runtime.isLocale(locale) ? locale : runtime.baseLocale;
  if (next !== runtime.getLocale()) runtime.setLocale(next, { reload: false });
}

/** Whether `n` takes the singular in the active language: French says "0 session", English "0 sessions". */
export function isOne(n: number): boolean {
  return new Intl.PluralRules(runtime.getLocale()).select(n) === "one";
}

/** The active language, for Intl date and number formatting. */
export const locale = (): string => runtime.getLocale();
