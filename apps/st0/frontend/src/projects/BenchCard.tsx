// BenchCard.tsx — the bench, on the one screen that can offer it: a live rig you open to hear a
// module, and throw away. It names no chain and no project, so the card is one button; it needs a
// library all the same, since every module it can reach is in one.
// See apps/pl8/docs/banc.md and ../../docs/projects.md.

import { FlaskConical } from "@frediverse/ui/icons";
import type { AccountLibrary } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";
import { benchHref } from "./api";

export function BenchCard({
  libraries,
}: {
  /** `undefined` while the card above is still reading; empty when there is none — and then there is no bench. */
  libraries: AccountLibrary[] | undefined;
}) {
  // No library, no bench: the card above is the thing to do, and a second empty box beside it says nothing.
  if (!libraries?.length) return null;

  return (
    <div className="flex flex-col gap-2 border-b px-6 py-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical className="h-4 w-4" />
        {m["bench.title"]()}
      </div>
      <p className="text-xs text-muted-foreground">{m["bench.body"]()}</p>

      <div>
        <a
          className="inline-block rounded-md border border-border bg-secondary px-3 py-1.5 text-xs hover:border-primary"
          href={benchHref()}
          title={m["bench.openHint"]()}
        >
          {m["bench.open"]()}
        </a>
      </div>
    </div>
  );
}
