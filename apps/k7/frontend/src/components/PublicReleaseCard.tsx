// One release on a public page. The visitor picks among the versions the server offered, which
// starts on the page's own pick; the choice is theirs alone and is never saved.

import { Card } from "@frediverse/ui/card";
import { Download } from "lucide-react";
import { useState } from "react";
import type { Release, SongEnvelope } from "../types";
import { WaveformPlayer } from "./WaveformPlayer";

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
    <Card className="page-release">
      <div className="version-head">
        <b className="version-name">
          {r.title} <span className="muted">· {r.artist}</span>
        </b>
        {versions.length > 1 && (
          <select
            aria-label={`Version of ${r.title}`}
            value={picked ?? ""}
            onChange={(e) => setPicked(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {r.canDownload && played && (
          <a
            className="download-link"
            href={downloadUrl(played.id)}
            download
            title={`Download ${played.name}`}
          >
            <Download className="size-4" /> Download
          </a>
        )}
      </div>
      {played && (
        <WaveformPlayer
          key={played.id}
          src={audioUrl(played.id)}
          shapeOf={() => envelope(played.id)}
        />
      )}
    </Card>
  );
}
