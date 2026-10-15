// syncWait.tsx — the wait before a project opens on a machine that syncs with a relay: its text
// caught up and every file it names on disk, else it compiles to "file missing". The machine
// answers `/sync/project`; `/open` refuses with 409 until it says ready, so this wait is the
// courtesy and the refusal is the rule. An older service without the route has nothing to wait
// for. See docs/launch.md, "Waiting for sync".

import { CloudDownload, CloudOff } from "@frediverse/ui/icons";
import type { ProjectSyncState } from "@studio/web-protocol";
import { fileRoutes } from "./files.ts";

/** What the sync wait says; the app's own wording, else the English below. */
export interface SyncWaitStrings {
  title: (workspace: string) => string;
  connecting: string;
  catchingUp: string;
  downloading: (files: number) => string;
  offline: (files: number) => string;
}

export const SYNC_WAIT_ENGLISH: SyncWaitStrings = {
  title: (workspace) => `Syncing ${workspace}`,
  connecting: "Reaching the server…",
  catchingUp: "Bringing the latest edits…",
  downloading: (files) =>
    `${files} file${files === 1 ? "" : "s"} still downloading…`,
  offline: (files) =>
    `The server is out of reach, and ${files} file${files === 1 ? "" : "s"} of this project never arrived. It opens once they do.`,
};

/** How often the machine is asked: the wait is the only thing on screen. */
const SYNC_POLL_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `project` is up to date, handing `onState` every answer that is not; false when cancelled first. */
export async function waitForSync(
  project: string,
  onState: (s: ProjectSyncState) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  for (;;) {
    let s: ProjectSyncState;
    try {
      s = await fileRoutes.syncProject(project);
    } catch (e) {
      // A service from before the route, or a frozen share, has nothing on its way.
      if ((e as { status?: number }).status === 404) return !cancelled();
      throw e;
    }
    if (cancelled()) return false;
    if (s.ready) return true;
    onState(s);
    await sleep(SYNC_POLL_MS);
    if (cancelled()) return false;
  }
}

/** The screen of that wait: which workspace, and what it is waiting for. */
export function SyncScreen({
  workspace,
  sync,
  strings = SYNC_WAIT_ENGLISH,
}: {
  workspace: string;
  sync: ProjectSyncState | null;
  strings?: SyncWaitStrings;
}) {
  const offline = sync?.state === "offline";
  const line = !sync
    ? strings.connecting
    : sync.state === "downloading"
      ? strings.downloading(sync.pending)
      : sync.state === "catching-up"
        ? strings.catchingUp
        : offline
          ? strings.offline(sync.pending)
          : strings.connecting;
  const Icon = offline ? CloudOff : CloudDownload;
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <Icon className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{strings.title(workspace)}</h1>
        <p className="text-sm text-muted-foreground">{line}</p>
        {/* No percentage: the machine knows what is missing, not how much will arrive after it. */}
        {!offline && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
