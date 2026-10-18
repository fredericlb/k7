// EngineMissingDialog.tsx — the popin when a project reaches the engine short of something it names:
// a sample, a clip, a patch, a model, a plugin (../engineMissing.ts). Dismissable: the project plays.
// The one thing a reader would get wrong: every edit re-applies the project and repeats the warnings,
// so it opens only when something NEW is missing, never twice for the same file.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import type { EngineClient } from "@studio/engine-browser";
import { useEffect, useState } from "react";
import { type MissingItem, missingKey, missingOf } from "../engineMissing";
import { m } from "../paraglide/messages.js";

/** How many items are listed before the rest is summed up. */
const LISTED = 12;
/** One apply's warnings arrive in a burst; this long after the last, the burst is over. */
const SETTLE_MS = 1000;

const WHY: Record<MissingItem["why"], () => string> = {
  refused: () => m["engineMissing.refused"](),
  "not-found": () => m["engineMissing.notFound"](),
  "not-installed": () => m["engineMissing.notInstalled"](),
};

/** The items of the latest apply when one of them was not shown before, else null. */
function useEngineMissing(
  engine: EngineClient | null | undefined,
): [MissingItem[] | null, () => void] {
  const [open, setOpen] = useState<MissingItem[] | null>(null);
  useEffect(() => {
    if (!engine) return;
    const shown = new Set<string>();
    let burst = new Map<string, MissingItem>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const items = [...burst.values()];
      burst = new Map();
      const fresh = items.some((i) => !shown.has(missingKey(i)));
      for (const i of items) shown.add(missingKey(i));
      if (fresh) setOpen(items);
    };
    const off = engine.onWarning(({ message }) => {
      const item = missingOf(message);
      if (!item) return;
      burst.set(missingKey(item), item);
      clearTimeout(timer);
      timer = setTimeout(flush, SETTLE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [engine]);
  return [open, () => setOpen(null)];
}

export function EngineMissingDialog({
  engine,
}: {
  engine: EngineClient | null | undefined;
}) {
  const [items, dismiss] = useEngineMissing(engine);
  return (
    <Dialog open={!!items} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m["engineMissing.title"]()}</DialogTitle>
          <DialogDescription>{m["engineMissing.body"]()}</DialogDescription>
        </DialogHeader>
        <div className="max-h-60 overflow-y-auto rounded bg-muted px-2 py-1.5 text-xs">
          {(items ?? []).slice(0, LISTED).map((i) => (
            <div key={missingKey(i)} className="truncate">
              <span className="font-mono text-red-400">{i.name}</span>{" "}
              <span className="text-muted-foreground">
                — {i.what}, {WHY[i.why]()}
              </span>
            </div>
          ))}
          {(items?.length ?? 0) > LISTED && (
            <div className="text-muted-foreground">
              … +{(items?.length ?? 0) - LISTED}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {m["engineMissing.logs"]()}
        </p>
        <DialogFooter>
          <Button onClick={dismiss}>{m["common.dismiss"]()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
