// ShotFrames.tsx — the filmstrip an expanded picture lane draws under a shot's name: frames laid
// edge to edge for the whole shot, each the source at the time its left edge stands for.
// What a reader gets wrong: only the tiles inside the visible window are mounted, so a shot an
// hour long at a deep zoom costs what the screen shows, not what the shot holds (docs/picture.md).

import { useEffect, useRef, useState } from "react";
import { aspectOf, frameAt } from "./shotFrames";

/** One tile: a canvas painted once its frame arrives, blank until then. */
function Tile({
  url,
  sec,
  still,
  left,
  width,
}: {
  url: string;
  sec: number;
  still: boolean;
  left: number;
  width: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void frameAt(url, sec, still).then((b) => {
      const cv = ref.current;
      if (!live || !b || !cv) return;
      cv.width = b.width;
      cv.height = b.height;
      cv.getContext("2d")?.drawImage(b, 0, 0);
    });
    return () => {
      live = false;
    };
  }, [url, sec, still]);
  return (
    <canvas
      ref={ref}
      className="absolute inset-y-0 h-full bg-black/40"
      style={{ left, width }}
    />
  );
}

export function ShotFrames({
  url,
  still,
  sourceFrom,
  speed = 1,
  pxPerSec,
  width,
  height,
  winLeft,
  winRight,
}: {
  url: string;
  still: boolean;
  /** Seconds into the source the shot starts at. */
  sourceFrom: number;
  /** Signed rate of the source under the shot; 0 holds `sourceFrom`. */
  speed?: number;
  pxPerSec: number;
  /** The shot's drawn width and the strip's height, in pixels. */
  width: number;
  height: number;
  /** The visible window, in pixels from the shot's left edge. */
  winLeft: number;
  winRight: number;
}) {
  // The aspect is known only once the source opened: re-render when the first frame lands.
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    void frameAt(url, sourceFrom, still).then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [url, sourceFrom, still]);
  const tw = Math.max(8, Math.round(height * aspectOf(url)));
  const first = Math.max(0, Math.floor(winLeft / tw));
  const last = Math.min(Math.ceil(width / tw), Math.ceil(winRight / tw));
  const tiles = [];
  for (let k = first; k < last; k++)
    tiles.push(
      <Tile
        key={k}
        url={url}
        still={still}
        sec={sourceFrom + ((k * tw) / pxPerSec) * speed}
        left={k * tw}
        width={tw}
      />,
    );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {tiles}
    </div>
  );
}
