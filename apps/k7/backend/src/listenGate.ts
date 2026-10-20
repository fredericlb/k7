// listenGate.ts — on a standalone (the desktop app, the phone), the backend LISTENS only once the
// hub's first library ensure has settled: every host calls it ready on its first answer, and a
// workspace created before the bundled library is installed has none. A failure or a slow copy
// never holds the start past LIBRARY_WAIT_MS. See ../docs/standalone.md, "Ready means the library is there".

import type { LibraryNote } from "@studio/web-protocol";

/** Under the hosts' own 60 s for a first answer, so a slow copy delays the start rather than failing it. */
export const LIBRARY_WAIT_MS = 45_000;

/** What the gate saw: every note, or "late" when the copy was still running at the deadline. */
export type LibraryGateOutcome =
  | { state: "settled"; notes: LibraryNote[] }
  | { state: "late" };

/** Resolve once `settled` does or `waitMs` passes, whichever is first; logs what became of each library. */
export async function awaitLibraries(
  settled: Promise<LibraryNote[]>,
  log: (msg: string) => void,
  waitMs = LIBRARY_WAIT_MS,
): Promise<LibraryGateOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((res) => {
    timer = setTimeout(() => res("late"), waitMs);
  });
  const notes = settled.catch((e: Error): LibraryNote[] => [
    { name: "libraries", state: "failed", note: e.message },
  ]);
  try {
    const first = await Promise.race([notes, late]);
    if (first === "late") {
      log(
        `libraries | still installing after ${Math.round(waitMs / 1000)} s — listening anyway; creating a workspace waits for them`,
      );
      return { state: "late" };
    }
    for (const n of first)
      if (n.state === "failed")
        log(`libraries | '${n.name}' could not be installed: ${n.note}`);
      else if (n.state !== "current")
        log(`libraries | '${n.name}' ${n.state}: ${n.note}`);
    return { state: "settled", notes: first };
  } finally {
    clearTimeout(timer);
  }
}
