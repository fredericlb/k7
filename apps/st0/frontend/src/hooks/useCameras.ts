// useCameras.ts — the lenses this BROWSER can see, by label. The list belongs to the browser and
// not to the document: a project says which camera by a name a person reads, and the machine
// answers whether it has one. See packages/song/docs/camera.md.

import { useEffect, useState } from "react";

/** Their LABELS, in the order the browser lists them; empty until there is a camera and a permission. */
export function useCameras(): string[] {
  const [cameras, setCameras] = useState<string[]>([]);

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

  return cameras;
}
