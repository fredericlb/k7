// promptDue.ts — whether the first-launch prompt (./ServerPrompt.tsx) is due: once per launch, on a machine with no
// server saved, until the person unticks "remind me". A launch is a browser session. See ../../docs/localApp.md.

const OFF_KEY = "k7.serverPrompt.off";
const SEEN_KEY = "k7.serverPrompt.seen";

const read = (s: () => Storage, key: string): string | null => {
  try {
    return s().getItem(key);
  } catch {
    return null;
  }
};
const write = (s: () => Storage, key: string, v: string | null): void => {
  try {
    if (v === null) s().removeItem(key);
    else s().setItem(key, v);
  } catch {
    // A private window keeps nothing: the prompt comes back next launch.
  }
};

/** Due when no server is saved, the person still wants reminding, and this launch has not shown it yet. */
export function promptDue(serverCount: number): boolean {
  if (serverCount > 0) return false;
  if (read(() => localStorage, OFF_KEY) === "1") return false;
  return read(() => sessionStorage, SEEN_KEY) !== "1";
}

/** The prompt was answered: not again this launch, and never again unless `remind`. */
export function promptAnswered(remind: boolean): void {
  write(() => sessionStorage, SEEN_KEY, "1");
  write(() => localStorage, OFF_KEY, remind ? null : "1");
}
