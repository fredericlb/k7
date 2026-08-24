// online's i18n wiring.
//
// The catalogues are messages/en.json and messages/fr.json at the app root,
// compiled by the Paraglide plugin into src/paraglide/. Editing a message file
// recompiles on save.
//
// Components import the compiled messages directly — `import { m } from
// "../paraglide/messages.js"`, then m["header.title"]() — so there's no
// translation helper left to import from here. This file only binds the
// generated runtime to React.

import { createLocaleContext } from "@frediverse/i18n/react";
import * as runtime from "../paraglide/runtime.js";

export const { LocaleProvider, useLocale } = createLocaleContext(runtime);
