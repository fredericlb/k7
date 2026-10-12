// readFailure.ts — whether a failed read is the service's ANSWER or a blip. A 4xx is an answer (a
// project that does not compile, a file that is not there) and what it says replaces the view; a
// 5xx, a timeout or no response at all says nothing about the project, so the view keeps what it
// last knew. See docs/shell.md, "A fault stays in its pane".

/** True when the failure is a real answer about the project, false for a transient one. */
export function isAnswer(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}
