// One version of a release, on the release page: its shape, its stems, and what can be done to it.
// "Hidden" only keeps it out of a page's dropdown — ../../../docs/pages.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { ReleaseVersion, SongEnvelope } from "../types";
import { SwitchField } from "./SwitchField";
import { WaveformPlayer } from "./WaveformPlayer";

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
  return (
    <Card className={v.hidden ? "version-hidden" : undefined}>
      <div className="version-head">
        <span className="version-name">
          {v.isDefault ? "★ " : ""}
          {v.name}
        </span>
        {v.isDefault && <Badge variant="amber">default</Badge>}
        {v.hidden && <Badge>hidden</Badge>}
        {!v.isDefault && (
          <Button variant="outline" size="sm" onClick={onSetDefault}>
            Set default
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          title="Download"
          onClick={() => download(audioUrl, `${label} (${v.name})`)}
        >
          ⬇
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={swapping}
          title="Replace this version's file"
          onClick={onReplace}
        >
          ⇄
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Delete this version"
          onClick={onDelete}
        >
          🗑
        </Button>
      </div>

      <WaveformPlayer src={audioUrl} shapeOf={shapeOf} />

      <SwitchField
        checked={v.hidden}
        onCheckedChange={onHiddenChange}
        style={{ marginTop: 8 }}
      >
        Hidden from pages
      </SwitchField>

      {v.tracks.length > 0 && (
        <div className="stems">
          <div className="muted small" style={{ marginTop: 10 }}>
            Stems ({v.tracks.length})
          </div>
          <ul className="stem-list">
            {v.tracks.map((t) => (
              <li key={t.id} className="stem-row">
                <span className="stem-name" title={t.name}>
                  {t.name}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  title={`Download ${t.name}`}
                  onClick={() =>
                    download(trackUrl(t.id), `${label} - ${t.name}`)
                  }
                >
                  ⬇
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
