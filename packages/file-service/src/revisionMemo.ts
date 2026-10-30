// revisionMemo.ts — the half of the revision token read off the active project's files, kept between
// walks while the workspace's live capture vouches that nothing moved: its watcher is up and its change
// feed's generation has not moved. A ceiling walks anyway now and then, so an event the watcher lost
// delays an edit rather than hiding it. Without a watching feed every token is a walk. docs/workspace.md.

import type { ChangeFeed } from "./liveCapture.ts";
import {
  type SourcesSummary,
  sourcesOf,
  type WalkedFile,
} from "./projectWalk.ts";

/** The longest a summary is trusted on the feed's word alone — docs/workspace.md. */
export const REVISION_WALK_ANYWAY_MS = 10_000;

/** A feed that can say whether it is hearing the disk at all. */
export type WatchingFeed = ChangeFeed & { readonly watching: boolean };

interface Kept {
  dir: string;
  gen: number;
  at: number;
  sources: SourcesSummary;
}

export class RevisionMemo {
  private kept: Kept | null = null;

  constructor(
    private readonly feed: () => WatchingFeed | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** `dir`'s summary: the one kept when the feed vouches for it, else `walk`'s, kept for next time. */
  sources(dir: string, walk: () => WalkedFile[]): SourcesSummary {
    const feed = this.feed();
    const k = this.kept;
    if (
      feed?.watching &&
      k?.dir === dir &&
      k.gen === feed.generation &&
      this.now() - k.at < REVISION_WALK_ANYWAY_MS
    )
      return k.sources;
    return this.remember(dir, walk());
  }

  /** A walk of `dir` some other reader took: its summary is as fresh as one of ours. */
  remember(dir: string, files: WalkedFile[]): SourcesSummary {
    const sources = sourcesOf(files);
    const feed = this.feed();
    this.kept = feed?.watching
      ? { dir, gen: feed.generation, at: this.now(), sources }
      : null;
    return sources;
  }
}
