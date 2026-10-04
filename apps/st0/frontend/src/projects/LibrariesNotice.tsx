// LibrariesNotice.tsx — what the home page says about the libraries, which it no longer edits: one
// line when there is none or one failed to clone for this account, and nothing when all is well.
// The list itself is the header's Libraries panel (LibrariesCard.tsx), the admins' to change.

import { Button } from "@frediverse/ui/button";
import { LibraryBig, TriangleAlert } from "@frediverse/ui/icons";
import type { AccountLibrary } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";

export function LibrariesNotice({
  libraries,
  onOpen,
}: {
  /** `undefined` while unread: no warning before the answer. */
  libraries: AccountLibrary[] | undefined;
  onOpen: () => void;
}) {
  if (!libraries) return null;
  const said = !libraries.length
    ? m["libs.noticeMissing"]()
    : libraries.some((l) => l.error)
      ? m["libs.noticeFailed"]()
      : null;
  if (!said) return null;
  return (
    <div className="flex items-center gap-2 border-b border-b-amber-500/40 bg-amber-500/5 px-6 py-3 text-xs">
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="flex-1">{said}</span>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <LibraryBig className="h-3.5 w-3.5" /> {m["home.libraries"]()}
      </Button>
    </div>
  );
}
