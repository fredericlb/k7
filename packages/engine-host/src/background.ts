// background.ts — what a long-running process does with a failure nobody awaits: the guard
// around a promise no caller holds, and the net at the entry point. Node exits on an unhandled
// rejection, so an unguarded `void f()` in a timer is a crash with no line printed anywhere.
// Rationale, and why this is copied rather than shared: docs/background.md.

/**
 * Run a promise nobody awaits, and say so if it rejects.
 *
 * `void f()` is the idiom this replaces, and it is the one that kills the process: every timer
 * in the supervisor calls a poll that reaches the network or the disk, and a single rejection
 * takes the supervisor down with the engine orphaned behind it.
 */
export function guard(tag: string, p: Promise<unknown>): void {
  p.catch((e: unknown) => {
    const why = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`[host] ${tag} failed: ${why}\n`);
  });
}

/**
 * The last resort, installed once at the entry point — never from a library.
 *
 * The two halves are deliberately asymmetric. A rejection is a poll that failed, so it is
 * logged and the process lives. An uncaught exception leaves the process in a state nobody
 * can reason about, so it is logged WITH its stack and then exits: the tray relaunches us on
 * a backoff, and a clean restart beats a supervisor that keeps answering wrongly. Today it
 * dies either way — what this adds is the line saying which one happened.
 */
export function installProcessNet(): void {
  process.on("unhandledRejection", (reason) => {
    const why =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason);
    process.stderr.write(`[host] unhandled rejection: ${why}\n`);
  });
  process.on("uncaughtException", (e) => {
    process.stderr.write(`[host] uncaught: ${e.stack ?? e.message}\n`);
    process.exit(1);
  });
}
