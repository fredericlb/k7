// i18n.ts — bind Paraglide's generated runtime to React. The catalogues live in
// messages/<locale>.json and compile into src/paraglide/, which components import
// directly. Deliberately NOT localized: the command reference and file syntax (the
// commands are English) and anything fetched from the backend. LocaleProvider is mounted
// above <AuthGate/> in main.tsx — keep it there; nothing rendering a message may sit above it.

import { createLocaleContext } from "@frediverse/i18n/react";
import * as runtime from "./paraglide/runtime.js";

export const { LocaleProvider, useLocale } = createLocaleContext(runtime);
