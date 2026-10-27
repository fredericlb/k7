// useCameras.ts — the lenses this BROWSER can see, by label, and the account's remote cameras that
// are on, as `remote:<device name>`. The list belongs to the browser and the account, not to the
// document: a project says which camera by a name a person reads. See packages/song/docs/camera.md.

import { listRemoteCameras } from "@studio/k7-plugins/video/camera/remoteCamera";
import { remoteLabel } from "@studio/web-protocol/cameras";
import { useEffect, useMemo, useState } from "react";

/** A camera mode coming on or off is noticed within this; the list is only read while a graph is shown. */
const REMOTE_POLL_MS = 5000;

/** Their LABELS, the local ones in the order the browser lists them, then the remote ones. */
export function useCameras(): string[] {
  const [cameras, setCameras] = useState<string[]>([]);
  const [remote, setRemote] = useState<string[]>([]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let live = true;
    const read = () => {
      void media
        .enumerateDevices()
        .then((all) => {
          if (!live) return;
          // A camera with NO label is one this browser has not been given permission for yet: it
          // exists, and it cannot be named, so it is not offered — picking it would write "".
          setCameras(
            all
              .filter((d) => d.kind === "videoinput" && d.label)
              .map((d) => d.label),
          );
        })
        .catch(() => undefined); // a browser that refuses to enumerate simply has none to offer
    };
    read();
    // Plugging a camera in mid-session is the ordinary way this list changes.
    media.addEventListener?.("devicechange", read);
    return () => {
      live = false;
      media.removeEventListener?.("devicechange", read);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const read = () =>
      void listRemoteCameras().then((list) => {
        if (!live) return;
        const next = list.map((c) => remoteLabel(c.name)).sort();
        // Same list, same array: the graph rebuilds its cards on a new one.
        setRemote((prev) =>
          prev.join("\n") === next.join("\n") ? prev : next,
        );
      });
    read();
    const timer = window.setInterval(read, REMOTE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return useMemo(
    () => (remote.length ? [...cameras, ...remote] : cameras),
    [cameras, remote],
  );
}
