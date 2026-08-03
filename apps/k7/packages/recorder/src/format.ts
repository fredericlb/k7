// Minimal time formatting used by the recorder/waveform UI. Kept local so the
// package doesn't depend on the app's broader format helpers.

/** Format seconds as H:MM:SS (or M:SS for short durations). */
export function fmtTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Format a date as "DD/MM HH:MM". */
function fmtStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/**
 * A session's display title. Sessions have no user-given name — they're
 * identified by their recording date & time (their createdAt).
 */
export function sessionTitle(iso: string): string {
  return fmtStamp(new Date(iso));
}
