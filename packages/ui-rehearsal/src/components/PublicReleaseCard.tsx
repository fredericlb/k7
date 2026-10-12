// One release on a public page, as a TrackCard. The visitor picks among the versions the server
// offered, which starts on the page's own pick; the choice is theirs alone and is never saved.

import { Download } from "@frediverse/ui/icons";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { Release, SongEnvelope } from "../types";
import { TrackCard } from "./TrackCard";

interface Props {
  release: Release;
  audioUrl: (versionId: string) => string;
  downloadUrl: (versionId: string) => string;
  envelope: (versionId: string) => Promise<SongEnvelope>;
}

export function PublicReleaseCard({
  release: r,
  audioUrl,
  downloadUrl,
  envelope,
}: Props) {
  const versions = r.versions ?? [];
  const [picked, setPicked] = useState(r.defaultVersionId ?? versions[0]?.id);
  const played = versions.find((v) => v.id === picked) ?? null;

  return (
    <TrackCard
      title={
        <>
          {r.title} <span className="muted">· {r.artist}</span>
        </>
      }
      picker={
        versions.length > 1
          ? {
              label: m["track.versionOf"]({ title: r.title }),
              value: picked ?? "",
              options: versions.map((v) => ({ value: v.id, label: v.name })),
              onChange: setPicked,
            }
          : undefined
      }
      // Kept in sight rather than in a ⋮: it is the one thing a visitor can do besides listen.
      actions={
        r.canDownload &&
        played && (
          <a
            className="download-link"
            href={downloadUrl(played.id)}
            download
            title={m["track.downloadNamed"]({ name: played.name })}
          >
            <Download className="size-4" /> {m["common.download"]()}
          </a>
        )
      }
      menuLabel={m["track.menu"]({ title: r.title })}
      audio={
        played
          ? { src: audioUrl(played.id), shapeOf: () => envelope(played.id) }
          : null
      }
    />
  );
}
