// uploadLabel.ts — what an upload in flight says: a share while its bytes leave, then that the
// server is at work on them. Null is "started, nothing reported yet" — ../docs/recordings.md.

import { m } from "./paraglide/messages.js";

export function uploadLabel(progress: number | null): string {
  if (progress === null) return m["common.uploading"]();
  if (progress < 1)
    return m["common.uploadProgress"]({
      percent: String(Math.round(progress * 100)),
    });
  return m["common.analyzing"]();
}
