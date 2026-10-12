// libraryRelay.ts — the libraries as st0fs workspaces: the hub is the server's replica of each, watching
// its folder and relaying every change to the room `<name>` of the account LIBRARIES_ACCOUNT.
// Only this hub holds that account's secret, so no account's replica can write a library: admins
// write the folder itself, and the hub's capture is what sends it. See docs/fileHub.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { ConfirmedDir } from "@studio/file-service/src/liveConfirmed.ts";
import { loadHead, RelayLink } from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspaceFilter.ts";
import { Replica } from "@studio/live-sync/replica";

/** The account the libraries' rooms belong to; every real account's slug ends in `-<hash>` (accountKey), this one cannot. */
export const LIBRARIES_ACCOUNT = "_libraries";

const REPLICA_ID = "hub-libraries";

export class LibraryRelay {
  private link: RelayLink | null = null;
  private readonly live = new Map<string, () => void>();

  constructor(
    private readonly home: string,
    private readonly url: string,
    /** What the relay recognises as LIBRARIES_ACCOUNT; made per process, never written anywhere. */
    readonly secret: string,
    private readonly log: (msg: string) => void,
  ) {}

  /** Replicate exactly the libraries listed and present on disk. */
  follow(list: { name: string }[]): void {
    this.link ??= new RelayLink(this.url, { secret: this.secret }, (m) =>
      this.log(`libraries | ${m}`),
    );
    const names = new Set(list.map((l) => l.name));
    for (const [name, stop] of this.live)
      if (!names.has(name)) {
        stop();
        this.live.delete(name);
      }
    for (const name of names)
      if (!this.live.has(name) && existsSync(join(this.home, name)))
        this.start(name, this.link);
  }

  stop(): void {
    for (const stop of this.live.values()) stop();
    this.live.clear();
    this.link?.close();
    this.link = null;
  }

  private start(name: string, link: RelayLink): void {
    const root = join(this.home, name);
    // A dot-folder is never a library, so the replica's own state beside them is never listed as one.
    const logDir = join(this.home, ".sync-replica", name);
    const capture = new LiveCapture({
      root,
      replica: REPLICA_ID,
      skip,
      isBinary,
      onBatch: (b) => link.local(name, b),
      // Its bytes go to LIBRARIES_ACCOUNT's blob store, beside the rooms (docs/blobs.md).
      blobDir: join(logDir, "blobs"),
      onMissingBlob: (blob) => link.fetch(name, blob),
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
    link.add({ name, capture, replica, written, onRemote: () => {} }, logDir);
    capture.start(replica.head > 0 ? confirmed : undefined);
    this.live.set(name, () => {
      capture.stop();
      link.remove(name);
    });
  }
}
