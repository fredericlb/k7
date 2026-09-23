// One version of a release, on the release page: a TrackCard whose ⋮ holds everything that can be
// done to it, stems included. "Hidden" only keeps it out of a page's dropdown — ../../../docs/pages.md.

import { Badge } from "@frediverse/ui/badge";
import { m } from "../paraglide/messages.js";
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
      : [{ label: m["version.setDefault"](), onSelect: onSetDefault }]),
    {
      label: m["common.download"](),
      onSelect: () => void download(audioUrl, `${label} (${v.name})`),
    },
    {
      label: m["version.replace"](),
      onSelect: onReplace,
      disabled: swapping,
    },
    {
      label: v.hidden ? m["version.show"]() : m["version.hide"](),
      onSelect: () => onHiddenChange(!v.hidden),
    },
    ...v.tracks.map((t, i) => ({
      label: m["version.downloadStem"]({ name: t.name }),
      onSelect: () => void download(trackUrl(t.id), `${label} - ${t.name}`),
      separatorBefore: i === 0,
    })),
    {
      label: m["version.delete"](),
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        if (confirm(m["common.confirmDeleteNamed"]({ name: v.name })))
          onDelete();
      },
    },
  ];

  return (
    <TrackCard
      title={v.name}
      badges={
        <>
          {v.isDefault && (
            <Badge variant="amber">{m["version.default"]()}</Badge>
          )}
          {v.hidden && <Badge>{m["version.hidden"]()}</Badge>}
        </>
      }
      menu={menu}
      menuLabel={m["track.menu"]({ title: v.name })}
      audio={{ src: audioUrl, shapeOf }}
      dimmed={v.hidden}
    />
  );
}
