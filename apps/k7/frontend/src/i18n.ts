// i18n wiring. Every string a person reads lives in messages/<locale>.json at the app root,
// compiled by the Paraglide plugin into src/paraglide/; a screen calls m["the.key"]().
// LocaleProvider is mounted above <App/> in main.tsx — nothing that renders a message may sit
// above it. Settings forces a language; otherwise the browser's own wins — ../../docs/i18n.md.

import { createLocaleContext } from "@frediverse/i18n/react";
import * as runtime from "./paraglide/runtime.js";

export const { LocaleProvider, useLocale } = createLocaleContext(runtime);

/** Whether `n` takes the singular in the active language: French says "0 session", English "0 sessions". */
export function isOne(n: number): boolean {
  return new Intl.PluralRules(runtime.getLocale()).select(n) === "one";
}

/** The active language, for Intl date and number formatting. */
export const locale = (): string => runtime.getLocale();
