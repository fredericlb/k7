import { locale } from "./i18n";

// A take's time and stamp formats are the recorder's, so a session reads the same on both sides.
export { fmtStamp, fmtTime, sessionTitle } from "@studio/recorder";

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(locale());
}
