// libraryRelay.ts — the libraries as st0fs workspaces. On the origin the hub is the server's replica of
// each, watching its folder and relaying every change to the room `<name>` of LIBRARIES_ACCOUNT.
// On a PAIRED machine it follows the origin's rooms instead, read-only, as `@lib/<name>`: a local edit is undone.
// Only the origin's hub holds that account's secret, so no replica writes a library. See docs/fileHub.md.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { ConfirmedDir } from "@studio/file-service/src/liveConfirmed.ts";
import { loadHead, RelayLink } from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspaceFilter.ts";
import { Replica } from "@studio/live-sync/replica";

/** The account the libraries' rooms belong to; every real account's slug ends in `-<hash>` (accountKey), this one cannot. */
export const LIBRARIES_ACCOUNT = "_libraries";

/** The prefix a replica of another account names a library room by — syncRelay.ts's SHARED_PREFIX. */
const FOLLOW_PREFIX = "@lib/";

const REPLICA_ID = "hub-libraries";

/** Whose rooms the libraries replicate: this hub's own relay, or a remote origin's, by a device token. */
type Source = { remote: null } | { remote: { url: string; token: string } };

export class LibraryRelay {
  private link: RelayLink | null = null;
  private readonly live = new Map<string, () => void>();
  private source: Source = { remote: null };
  private list: { name: string }[] = [];

  constructor(
    private readonly home: string,
    private readonly url: string,
    /** What the relay recognises as LIBRARIES_ACCOUNT; made per process, never written anywhere. */
    readonly secret: string,
    private readonly log: (msg: string) => void,
  ) {}

  /** Replicate exactly the libraries listed (and, from this hub's relay, present on disk). */
  follow(list: { name: string }[]): void {
    this.list = list;
    const link = this.linkFor();
    const names = new Set(list.map((l) => l.name));
    for (const [name, stop] of this.live)
      if (!names.has(name)) {
        stop();
        this.live.delete(name);
      }
    for (const name of names)
      if (
        !this.live.has(name) &&
        (this.following || existsSync(join(this.home, name)))
      )
        this.start(name, link);
  }

  /** Follow a remote origin's libraries with a device token; a no-op when already following that one. */
  followRemote(url: string, token: string): void {
    const r = this.source.remote;
    if (r?.url === url && r.token === token) return;
    this.switchTo({ remote: { url, token } });
  }

  /** Replicate the libraries to this hub's own relay again; a no-op when already doing so. */
  followLocal(): void {
    if (this.source.remote) this.switchTo({ remote: null });
  }

  stop(): void {
    for (const stop of this.live.values()) stop();
    this.live.clear();
    this.link?.close();
    this.link = null;
  }

  private get following(): boolean {
    return this.source.remote !== null;
  }

  private switchTo(source: Source): void {
    const running = this.link !== null;
    this.stop();
    this.source = source;
    this.log(
      `libraries | ${source.remote ? `following ${source.remote.url} read-only` : "relayed to this hub"}`,
    );
    if (running) this.follow(this.list);
  }

  private linkFor(): RelayLink {
    if (this.link) return this.link;
    const r = this.source.remote;
    const log = (m: string) => this.log(`libraries | ${m}`);
    this.link = r
      ? new RelayLink(r.url, { token: r.token }, log, undefined, true)
      : new RelayLink(this.url, { secret: this.secret }, log);
    return this.link;
  }

  private start(name: string, link: RelayLink): void {
    const root = join(this.home, name);
    if (this.following) mkdirSync(root, { recursive: true });
    const room = this.following ? `${FOLLOW_PREFIX}${name}` : name;
    // Each source keeps its own head: the two relays' seqs are not the same numbers.
    const logDir = join(
      this.home,
      this.following ? ".sync-follow" : ".sync-replica",
      name,
    );
    const capture = new LiveCapture({
      root,
      replica: REPLICA_ID,
      skip,
      isBinary,
      onBatch: (b) => link.local(room, b),
      // Its bytes go to (or come from) LIBRARIES_ACCOUNT's blob store, beside the rooms (docs/blobs.md).
      blobDir: join(logDir, "blobs"),
      onMissingBlob: (blob) => link.fetch(room, blob),
    });
    const written: string[] = [];
    const confirmed = new ConfirmedDir(join(logDir, "confirmed"));
    const host = {
      read: (f: string) => capture.read(f),
      write: (f: string, t: string | null) => {
        written.push(f);
        capture.writeKnown(f, t);
      },
    };
    const replica = new Replica(REPLICA_ID, host, confirmed, loadHead(logDir));
    link.add(
      { name: room, capture, replica, written, onRemote: () => {} },
      logDir,
    );
    capture.start(replica.head > 0 ? confirmed : undefined);
    this.live.set(name, () => {
      capture.stop();
      link.remove(room);
    });
  }
}
