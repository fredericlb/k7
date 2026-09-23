// The pl8 address a médiathèque file streams from, once pl8's base is known: k7 keeps no copy of a
// song's track or instrumental, the player reads them from pl8 — ../../docs/audio.md.

import { useEffect, useState } from "react";
import { pl8StreamUrl } from "../fetchSong/pl8";

/** The stream URL of `path`, or null while pl8's base is being read (and for no path at all). */
export function usePl8Stream(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    void pl8StreamUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => {}); // no config: nothing to play, which the player shows as no track
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
