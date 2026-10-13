// LibraryUpgrades.tsx — above the file tree, one line per library this workspace could move to a
// newer version of, with the button that does it. The button runs `library upgrade`, the palette's
// verb, so the refusal of a version too new for this st0 is the verb's, said once. See
// ../../../../../docs/library-versions-plan.md.

import { Button } from "@frediverse/ui/button";
import { Loader2 } from "@frediverse/ui/icons";
import type { ModuleLibrary } from "@studio/web-protocol";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function LibraryUpgrades({
  levels,
  onUpgrade,
}: {
  levels: readonly ModuleLibrary[];
  /** Run `library upgrade <ns> <version>`, then read the libraries again. */
  onUpgrade: (ns: string, version: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const ready = levels.filter((l) => l.version?.upgrade !== undefined);
  if (!ready.length) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-2 py-1.5 text-xs">
      {ready.map((l) => {
        const to = l.version?.upgrade as number;
        return (
          <div key={l.ns} className="flex items-center gap-2">
            <span className="flex-1 truncate text-muted-foreground">
              {m["libs.upgradeReady"]({
                name: l.ns,
                from: String(l.version?.pinned),
                to,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                setBusy(l.ns);
                void onUpgrade(l.ns, to).finally(() => setBusy(null));
              }}
            >
              {busy === l.ns && (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              )}
              {m["libs.upgrade"]()}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
