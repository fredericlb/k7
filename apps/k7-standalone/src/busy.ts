// busy.ts — what the quit confirm says, from what the k7 pages answered: a take recording outranks the transport playing.

/** A page's answer to `window.__k7Busy()`, mirrored by apps/k7/frontend/src/desktopBusy.ts; null when idle. */
export type K7Busy = "playing" | "recording";

export interface BusyReason {
  message: string;
  detail: string;
}

/** The confirm's text, or null when no page is busy. */
export function busyReason(answers: readonly K7Busy[]): BusyReason | null {
  if (answers.includes("recording"))
    return {
      message: "A take is recording. Quit k7 anyway?",
      detail:
        "Quitting stops the recording; what was taken so far may be lost.",
    };
  if (answers.includes("playing"))
    return {
      message: "k7 is playing. Quit anyway?",
      detail: "Quitting stops the engine and the sound with it.",
    };
  return null;
}
