// One version of a release, on the release page: a TrackCard whose ⋮ holds everything that can be
// done to it, stems included. "Hidden" only keeps it out of a page's dropdown — ../../../docs/pages.md.

import { Badge } from "@frediverse/ui/badge";
import type { ReleaseVersion, SongEnvelope } from "../types";
import { TrackCard, type TrackMenuEntry } from "./TrackCard";

interface Props {
  version: ReleaseVersion;
  /** "Artist - Title", the stem of every file name this card downloads. */
  label: string;
  audioUrl: string;
  shapeOf: () => Promise<SongEnvelope>;
  trackUrl: (trackId: string) => string;
  download: (url: string, fileName: string) => Promise<void>;
  swapping: boolean;
  onSetDefault: () => void;
  onReplace: () => void;
  onDelete: () => void;
  onHiddenChange: (hidden: boolean) => void;
}

export function VersionCard({
  version: v,
  label,
  audioUrl,
  shapeOf,
  trackUrl,
  download,
  swapping,
  onSetDefault,
  onReplace,
  onDelete,
  onHiddenChange,
}: Props) {
  const menu: TrackMenuEntry[] = [
    ...(v.isDefault
      ? []
      : [{ label: "Set as default", onSelect: onSetDefault }]),
    {
      label: "Download",
      onSelect: () => void download(audioUrl, `${label} (${v.name})`),
    },
    { label: "Replace the file…", onSelect: onReplace, disabled: swapping },
    {
      label: v.hidden ? "Show on pages" : "Hide from pages",
      onSelect: () => onHiddenChange(!v.hidden),
    },
    ...v.tracks.map((t, i) => ({
      label: `Download stem: ${t.name}`,
      onSelect: () => void download(trackUrl(t.id), `${label} - ${t.name}`),
      separatorBefore: i === 0,
    })),
    {
      label: "Delete version",
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        if (confirm(`Delete the version "${v.name}"?`)) onDelete();
      },
    },
  ];

  return (
    <TrackCard
      title={v.name}
      badges={
        <>
          {v.isDefault && <Badge variant="amber">default</Badge>}
          {v.hidden && <Badge>hidden</Badge>}
        </>
      }
      menu={menu}
      menuLabel={`${v.name} menu`}
      audio={{ src: audioUrl, shapeOf }}
      dimmed={v.hidden}
    />
  );
}
