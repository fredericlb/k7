// The recorder's date and time formats, bound to this catalogue's language, so a session reads the same on both sides.

import {
  type DateStyle,
  formatDate,
  sessionTitle as titleIn,
} from "@studio/recorder";
import { locale } from "./i18n";

export { fmtTime } from "@studio/recorder";

/** `at` in the named style and the app's language. */
export const fmtDate = (at: Date | string | number, style: DateStyle): string =>
  formatDate(at, style, locale());

/** A session's title: its recording date and time, in the app's language. */
export const sessionTitle = (iso: string): string => titleIn(iso, locale());
