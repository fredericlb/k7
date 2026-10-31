// The one place a date or a clock is worded, for the recorder, the médiathèque and the rehearsal pages.
// The locale is always the APP's, passed in: the browser's own would print English dates in a French app.
// The styles and why there are only these: ../docs/recorder.md.

/** Format seconds as H:MM:SS (or M:SS for short durations). */
export function fmtTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The named ways a moment in time is printed; a screen picks one, never its own options. */
export type DateStyle =
  | "day"
  | "date"
  | "dateTime"
  | "stamp"
  | "time"
  | "timeSeconds";

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  // A day as a page title: "Tuesday, October 27, 2026".
  day: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  // A day in a sentence: "Oct 27, 2026".
  date: { dateStyle: "medium" },
  // When something was made: "Oct 27, 2026, 1:13 PM".
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  // A session's name, short enough for a title: "Oct 27, 1:13 PM".
  stamp: { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  // A clock on a timeline: "1:13 PM".
  time: { hour: "numeric", minute: "2-digit" },
  timeSeconds: { hour: "numeric", minute: "2-digit", second: "2-digit" },
};

/** `at` in the named style and the app's language (a BCP 47 tag); an unreadable date prints empty. */
export function formatDate(
  at: Date | string | number,
  style: DateStyle,
  locale: string,
): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, STYLES[style]);
}

/** A stamp of now or of `d`, as a resumed take's note says when it went on. */
export function fmtStamp(locale: string, d: Date = new Date()): string {
  return formatDate(d, "stamp", locale);
}

/** A session's title: it has no name, so its recording date and time. */
export function sessionTitle(iso: string, locale: string): string {
  return formatDate(iso, "stamp", locale);
}
