// PlacedShot.tsx — a shot a placed TIMELINE draws on a song picture lane: dashed, not draggable, and
// opened where it is edited by a double-click. What a reader gets wrong: it is not in the lane's file, so
// the picture verbs and the drag, which address that file by index, must never see it (docs/picture.md).

import type { WebVideoTrack } from "@studio/web-protocol";
import { TrackIcon } from "../../trackIcons";

type Clip = WebVideoTrack["clips"][number];

/** The song lane's OWN shots, indexed as its file is — a placed timeline's are drawn apart, by `PlacedShot`. */
export const ownShots = (t: WebVideoTrack): WebVideoTrack =>
  t.clips.some((c) => c.timeline)
    ? { ...t, clips: t.clips.filter((c) => !c.timeline) }
    : t;

export function PlacedShot({
  clip,
  left,
  width,
  onOpen,
}: {
  clip: Clip;
  left: number;
  width: number;
  onOpen: (timeline: string) => void;
}) {
  const name = clip.name || "on";
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (clip.timeline) onOpen(clip.timeline);
      }}
      className="absolute inset-y-0.5 flex items-center gap-0.5 overflow-hidden rounded-sm border border-violet-400/70 border-dashed bg-violet-600/25 px-1 text-[10px] text-white/80"
      style={{ left, width }}
      title={`${name} — ${clip.length}s at ${clip.start}s, placed by timeline ${clip.timeline}`}
    >
      <TrackIcon
        name={clip.name}
        video
        className="h-2.5 w-2.5 shrink-0 opacity-60"
      />
      <span className="truncate">
        {clip.timeline} · {name}
      </span>
    </div>
  );
}
