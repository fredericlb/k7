// i18n wiring. The catalogues live in messages/<locale>.json at the app root
// (empty so far — this app's strings are still hardcoded in its components),
// compiled by the Paraglide plugin into src/paraglide/. To localize a screen:
// add the key to both message files, then `import { m } from
// "../paraglide/messages.js"` and call m["the.key"]().
//
// This file only binds the generated runtime to React. LocaleProvider is
// already mounted above <App/> in main.tsx — keep it there; nothing that
// renders a message may sit above it.

import { createLocaleContext } from "@frediverse/i18n/react";
import * as runtime from "../paraglide/runtime.js";

export const { LocaleProvider, useLocale } = createLocaleContext(runtime);
