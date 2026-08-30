// SurfaceQr.tsx — one address as a QR code, for the share panel's "on another device" section.
// A code and the name of what it opens, and nothing else: scanning IS the gesture here, and an
// address written out is what this replaces rather than something to keep beside it.
// The rebasing is the part that matters — see ../remoteUrl.ts.

import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { remoteUrl } from "../remoteUrl";

/** Two fit across the panel's 24rem with room for the border and the gap. */
const QR_PX = 150;

export function SurfaceQr({
  id,
  type,
  url,
  lanUrls,
}: {
  /** What it opens, by the name the project gives it. */
  id: string;
  type: string;
  /** Its address on THIS origin; rebased for the device that will scan it. */
  url: string;
  lanUrls: readonly string[];
}) {
  const reachable = remoteUrl(url, lanUrls, window.location.origin);
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!reachable) return;
    let live = true;
    setFailed(false);
    void QRCode.toDataURL(reachable, {
      width: QR_PX,
      margin: 1,
      // Drawn on the panel's own background, so the code carries no card of its own.
      color: { dark: "#e5e5e5ff", light: "#00000000" },
    })
      .then((d) => live && setPng(d))
      // Said rather than swallowed: a tile that spins for ever reads as a slow network.
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [reachable]);

  return (
    <li className="flex flex-col items-center gap-1 rounded-lg border border-border p-2">
      <span
        className="flex items-center justify-center"
        style={{ width: QR_PX, height: QR_PX }}
      >
        {reachable === null ? (
          <span className="text-center text-xs text-muted-foreground">
            cette machine n'a pas d'adresse réseau
          </span>
        ) : failed ? (
          <span className="text-center text-xs text-destructive">
            le code n'a pas pu être dessiné
          </span>
        ) : png ? (
          <img src={png} width={QR_PX} height={QR_PX} alt={`QR code — ${id}`} />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </span>
      <span className="w-full truncate text-center text-sm">{id}</span>
      <span className="w-full truncate text-center text-xs text-muted-foreground">
        {type}
      </span>
    </li>
  );
}
