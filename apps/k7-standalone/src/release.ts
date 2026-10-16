// release.ts — the release stamp this build ships under (`vX.Y.Z` or `snapshot-<commit>`), and how two stamps compare.
// The stamp is inlined by scripts/build-main.mjs; package.json's version does not move with a build. See docs/menu.md.

declare const __K7_RELEASE__: string | undefined;

/** The stamp of this build; `dev` for a checkout run or a build nobody stamped. */
export const RELEASE: string =
  typeof __K7_RELEASE__ === "string" ? __K7_RELEASE__ : "dev";

/** A stamp read: a tagged release and its numbers, a snapshot and its commit, or null for anything else. */
export type Stamp =
  | { kind: "release"; version: [number, number, number] }
  | { kind: "snapshot"; commit: string };

export function parseStamp(stamp: string): Stamp | null {
  const tag = /^v(\d+)\.(\d+)\.(\d+)$/.exec(stamp);
  if (tag) return { kind: "release", version: [+tag[1], +tag[2], +tag[3]] };
  const snap = /^snapshot-([0-9a-f]{7,40})$/.exec(stamp);
  return snap ? { kind: "snapshot", commit: snap[1] } : null;
}

/** Whether tag `b` is a later release than tag `a`; false when either is not `vX.Y.Z`. */
export function isNewerTag(a: string, b: string): boolean {
  const x = parseStamp(a);
  const y = parseStamp(b);
  if (x?.kind !== "release" || y?.kind !== "release") return false;
  for (let i = 0; i < 3; i++)
    if (x.version[i] !== y.version[i]) return y.version[i] > x.version[i];
  return false;
}

/** What About and the update check name the build: `0.1.0 (snapshot-9f2c1ab)` reads worse than the stamp alone. */
export const releaseLabel = (stamp: string = RELEASE): string =>
  parseStamp(stamp)?.kind === "release" ? stamp.slice(1) : stamp;
