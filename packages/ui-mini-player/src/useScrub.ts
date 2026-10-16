// useScrub.ts — a range that previews while it moves and seeks once it is let go: on the release
// of a pointer, a key, or the native `change` the browser fires at the end of a drag.
// Every commit is the same idempotent call, so whichever comes first wins — ../docs/miniPlayer.md.

import { useCallback, useEffect, useRef, useState } from "react";

export function useScrub(onSeek: (seconds: number) => void) {
  const [value, setValue] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const seek = useRef(onSeek);
  seek.current = onSeek;
  const ref = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    setValue(null);
    seek.current(v);
  }, []);

  const preview = useCallback((v: number) => {
    pending.current = v;
    setValue(v);
  }, []);

  // A pointer let go outside the range still ends the drag.
  const begin = useCallback(() => {
    window.addEventListener("pointerup", commit, { once: true });
    window.addEventListener("pointercancel", commit, { once: true });
  }, [commit]);

  // React's onChange is the native `input`; the native `change` is the end of a gesture.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("change", commit);
    return () => {
      el.removeEventListener("change", commit);
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    };
  }, [commit]);

  return { value, ref, preview, begin, commit };
}
