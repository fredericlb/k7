// background.ts — what a long-running process does with a failure nobody awaits: the guard
// around a promise no caller holds, and the net at the entry point. Node exits on an unhandled
// rejection, so an unguarded `void f()` in a route or a watcher takes the whole service down.
// Twin of packages/engine-host/src/background.ts, whose docs/background.md holds the rationale.

/**
 * Run a promise nobody awaits, and say so if it rejects.
 *
 * This service is ONE process: it holds the socket to the engine, the pattern clock and the
 * module watcher beside every request. A rejection from a fire-and-forget prewarm is not worth
 * any of that, and today it costs all of it.
 */
export function guard(tag: string, p: Promise<unknown>): void {
  p.catch((e: unknown) => {
    const why = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`   ✗ ${tag} failed: ${why}`);
  });
}

/** The last resort, installed once at the entry point — never from a library. */
export function installProcessNet(): void {
  process.on("unhandledRejection", (reason) => {
    const why =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason);
    console.error(`   ✗ unhandled rejection: ${why}`);
  });
  // Logged with its stack, then out: the supervisor's fileServiceWatch respawns us, and a clean
  // restart beats a service that keeps serving from a state nobody can reason about.
  process.on("uncaughtException", (e) => {
    console.error(`   ✗ uncaught: ${e.stack ?? e.message}`);
    process.exit(1);
  });
}
