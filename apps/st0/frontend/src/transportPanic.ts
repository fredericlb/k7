// transportPanic.ts — what a SECOND stop means. Pure, so the rule is testable without a transport.
//
// Every stop in this app goes through one callback (useEngineLink), which is why the rule lives at
// that seam rather than on the button: the key, the command bar and the button are the same gesture
// to a musician, and a rule on one of them would be a rule two thirds of the time.
// See engine/st0-engine/docs/panic.md for what each of the two actually does.

/**
 * How long a stop stays "the last stop". Short enough that two presses minutes apart are two stops,
 * long enough for a hand that has just heard the note keep going — the gesture is a double-click on
 * a button, not a keyboard repeat.
 */
export const PANIC_WINDOW_MS = 800;

/**
 * A stop, or the panic a second one means. `lastStopAt` is when the previous stop was sent, null for
 * none — and the caller records EVERY stop, so a third press inside the window panics again: a panic
 * is idempotent, and someone pressing a third time is not asking for less.
 */
export function stopOrPanic(
  now: number,
  lastStopAt: number | null,
): "stop" | "panic" {
  return lastStopAt !== null && now - lastStopAt <= PANIC_WINDOW_MS
    ? "panic"
    : "stop";
}
