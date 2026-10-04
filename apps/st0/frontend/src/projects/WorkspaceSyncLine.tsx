// WorkspaceSyncLine.tsx — under a workspace's name, what stands between it and its repository: an
// amber line when work here is not on the host (uncommitted, unpushed), a blue one when the host has
// commits this copy lacks. Both can show at once — a diverged workspace. Nothing when level.
// `WorkspaceSyncButtons` is the act on each line, drawn beside the row's New project.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { CloudDownload, CloudUpload } from "@frediverse/ui/icons";
import type { WorkspaceSync } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";

const plural = (n: number) => ({ n, s: n === 1 ? "" : "s" });

/** Work here the host lacks: uncommitted files, or commits not pushed. */
const hasChanges = (sync: WorkspaceSync): boolean =>
  sync.dirty > 0 || (sync.ahead ?? 0) > 0;

export function WorkspaceSyncButtons({
  sync,
  published,
  blocked,
  onPush,
  onPull,
}: {
  sync: WorkspaceSync | undefined;
  /** Has an `origin`: without one, Push can only commit. */
  published: boolean;
  /** Why the file service cannot be reached, or "". */
  blocked: string;
  onPush: () => void;
  onPull: () => void;
}) {
  if (!sync) return null;
  const changes = hasChanges(sync);
  const behind = (sync.behind ?? 0) > 0;
  return (
    <>
      {changes && (
        <Button
          variant="secondary"
          size="xs"
          disabled={Boolean(blocked)}
          title={
            blocked || (published ? m["ws.pushHint"]() : m["ws.commitHint"]())
          }
          onClick={onPush}
        >
          <CloudUpload className="mr-1 h-3.5 w-3.5" />
          {published ? m["ws.push"]() : m["ws.commit"]()}
        </Button>
      )}
      {behind && (
        // A pull only fast-forwards, so anything of this copy's own must reach the host first.
        <Button
          variant="secondary"
          size="xs"
          disabled={Boolean(blocked) || changes}
          title={
            blocked || (changes ? m["ws.pullBlocked"]() : m["ws.pullHint"]())
          }
          onClick={onPull}
        >
          <CloudDownload className="mr-1 h-3.5 w-3.5" />
          {m["ws.pull"]()}
        </Button>
      )}
    </>
  );
}

export function WorkspaceSyncLine({
  sync,
  command,
}: {
  sync: WorkspaceSync | undefined;
  /** The name `system repo sync` takes for this workspace, for the hint. */
  command: string;
}) {
  if (!sync) return null;
  const ahead = sync.ahead ?? 0;
  const behind = sync.behind ?? 0;
  const out = [
    sync.dirty > 0 && m["ws.syncDirty"](plural(sync.dirty)),
    ahead > 0 && m["ws.syncAhead"](plural(ahead)),
  ].filter(Boolean);
  if (!out.length && behind === 0) return null;
  const hint = m["ws.syncHint"]({ name: command });

  return (
    <span className="mt-0.5 flex flex-col gap-0.5 text-xs">
      {out.length > 0 && (
        <span className="flex items-center gap-1.5 text-amber-500" title={hint}>
          <CloudUpload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {m["ws.syncOut"]()} — {out.join(" · ")}
          </span>
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-1.5 text-sky-500" title={hint}>
          <CloudDownload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {m["ws.syncIn"]()} — {m["ws.syncBehind"](plural(behind))}
          </span>
        </span>
      )}
    </span>
  );
}
