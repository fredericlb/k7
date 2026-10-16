import { locale } from "./i18n";
import { m } from "./paraglide/messages.js";

// A take's time and stamp formats are the recorder's, so a session reads the same on both sides.
export { fmtStamp, fmtTime, sessionTitle } from "@studio/recorder";

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(locale());
}

/** A stable local-day key (YYYY-M-D) for grouping items by calendar day. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Inverse of dayKey: the local midnight Date for a "YYYY-M-D" key. */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m, d);
}

/** Human day label: "Today", "Yesterday", else e.g. "Monday, 7 July 2026". */
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(d).getTime()) / 86_400_000,
  );
  if (diffDays === 0) return m["date.today"]();
  if (diffDays === 1) return m["date.yesterday"]();
  return d.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
