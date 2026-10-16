// engineNotices.ts — which supervisor and engine events deserve an OS notification, and how often one may repeat. Pure, so it is tested.
// A notification is for what the person did not ask for: a plain stop may be their own Stop or Restart, so only an error speaks. See docs/notices.md.

import type { Snapshot } from "@studio/supervisor-host/hostProtocol";

export interface Notice {
  /** What repeats count against: one key, one notification per window of time. */
  key: string;
  title: string;
  body: string;
}

/** The notice a new snapshot calls for, given the one before it; null for nothing to say. */
export function snapshotNotice(
  prev: Pick<Snapshot, "status"> | null,
  next: Pick<Snapshot, "status" | "error">,
): Notice | null {
  if (next.status === "error" && prev?.status !== "error")
    return {
      key: "engine-error",
      title: "The audio engine stopped",
      body: next.error || "The supervisor is trying to start it again.",
    };
  if (prev?.status === "error" && next.status === "running")
    return {
      key: "engine-back",
      title: "The audio engine is back",
      body: "Playback can resume.",
    };
  return null;
}

/** The notice for the supervisor going away; null for its return, which the next snapshot reports. */
export const downNotice = (why: string | null): Notice | null =>
  why
    ? {
        key: "supervisor-down",
        title: "The engine's supervisor stopped",
        body: why,
      }
    : null;

/** Lets a key through once per `everyMs`: a crash loop is one notification, not one a second. */
export class RateLimit {
  private readonly last = new Map<string, number>();

  constructor(private readonly everyMs: number) {}

  allow(key: string, now: number): boolean {
    const at = this.last.get(key);
    if (at !== undefined && now - at < this.everyMs && now >= at) return false;
    this.last.set(key, now);
    return true;
  }
}
