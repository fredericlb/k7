import { locale } from "./i18n";
import { m } from "./paraglide/messages.js";

/** Format seconds as H:MM:SS (or M:SS for short durations). */
export function fmtTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

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

/** Format a date as "DD/MM HH:MM" for use as/within a session name. */
export function fmtStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** A session's title: it has no name, so its createdAt as "DD/MM HH:MM". */
export function sessionTitle(iso: string): string {
  return fmtStamp(new Date(iso));
}
