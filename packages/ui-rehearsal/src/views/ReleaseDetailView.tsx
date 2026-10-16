import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Download, EllipsisVertical } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { AUDIO_ACCEPT } from "@studio/mediatek/media";
import { useRef, useState } from "react";
import type { OnProgress } from "../api";
import { BackButton } from "../components/BackButton";
import { ReleaseEditForm } from "../components/ReleaseEditForm";
import { SwitchField } from "../components/SwitchField";
import { VersionCard } from "../components/VersionCard";
import { confirmLoss } from "../confirm";
import { fmtDate } from "../format";
import { m } from "../paraglide/messages.js";
import type { Release, ReleasePatch, SongEnvelope } from "../types";
import { uploadLabel } from "../uploadLabel";

interface Props {
  release: Release;
  onUpdate: (patch: ReleasePatch) => Promise<void>;
  onAddVersion: (
    data: {
      name: string;
      isDefault: boolean;
      audio: File;
    },
    onProgress?: OnProgress,
  ) => Promise<void>;
  /** Swap one version's file; its name, its stems and its place are kept. */
  onReplaceVersionAudio: (
    versionId: string,
    audio: File,
    onProgress?: OnProgress,
  ) => Promise<void>;
  onSetDefaultVersion: (versionId: string) => Promise<void>;
  onSetVersionHidden: (versionId: string, hidden: boolean) => Promise<void>;
  onDeleteVersion: (versionId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  versionAudioUrl: (versionId: string) => string;
  versionEnvelope: (versionId: string) => Promise<SongEnvelope>;
  versionTrackUrl: (versionId: string, trackId: string) => string;
  onBack: () => void;
}

export function ReleaseDetailView({
  release,
  onBack,
  onUpdate,
  onAddVersion,
  onReplaceVersionAudio,
  onSetDefaultVersion,
  onSetVersionHidden,
  onDeleteVersion,
  onDelete,
  versionAudioUrl,
  versionEnvelope,
  versionTrackUrl,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [vName, setVName] = useState("");
  const [vDefault, setVDefault] = useState(true);
  const [vFile, setVFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  // The share an upload in flight has sent; one at a time, since each disables the other.
  const [progress, setProgress] = useState<number | null>(null);
  // One input for the whole list; this remembers which version asked for it.
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  // The URL of a version's audio never changes, so a replaced file would play from the cache.
  const [bust, setBust] = useState<Record<string, number>>({});

  const askForFile = (versionId: string) => {
    setReplacing(versionId);
    replaceInput.current?.click();
  };

  const replacePicked = async (file: File | undefined) => {
    const versionId = replacing;
    setReplacing(null);
    if (!file || !versionId) return;
    setSwapping(true);
    setProgress(null);
    try {
      await onReplaceVersionAudio(versionId, file, setProgress);
      setBust((b) => ({ ...b, [versionId]: (b[versionId] ?? 0) + 1 }));
    } finally {
      setSwapping(false);
    }
  };

  const addVersion = async () => {
    if (!vFile) return;
    setAdding(true);
    setProgress(null);
    try {
      await onAddVersion(
        {
          name:
            vName.trim() ||
            m["release.versionN"]({ n: (release.versions?.length ?? 0) + 1 }),
          isDefault: vDefault,
          audio: vFile,
        },
        setProgress,
      );
      setVName("");
      setVFile(null);
      setVDefault(true);
    } finally {
      setAdding(false);
    }
  };

  const download = async (url: string, fileName: string) => {
    const res = await fetch(url, { credentials: "include" });
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(objUrl);
  };

  const remove = async () => {
    if (!(await confirmLoss(m["release.confirmDelete"]()))) return;
    await onDelete();
  };

  const versions = release.versions ?? [];
  const label = `${release.artist} - ${release.title}`;

  return (
    <div className="release-detail">
      {editing ? (
        <ReleaseEditForm
          release={release}
          onSave={async (patch) => {
            await onUpdate(patch);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="detail-head">
            <BackButton to={m["nav.publications"]()} onClick={onBack} />
            <h2>{release.title}</h2>
            <span className="muted detail-head-sub">
              {release.artist}
              {release.releaseDate ? ` · ${release.releaseDate}` : ""}
            </span>
            <Badge
              className="shrink-0"
              variant={release.canDownload ? "amber" : "default"}
            >
              {release.canDownload ? (
                <>
                  <Download className="size-3" /> {m["release.downloadable"]()}
                </>
              ) : (
                m["release.downloadDisabled"]()
              )}
            </Badge>
            {/* The release's verbs in one ⋮, like a song's, so the page below is the release. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ds-button"
                  title={m["release.menu"]()}
                  aria-label={m["release.menu"]()}
                >
                  <EllipsisVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="rehearsal-root" align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  {m["common.edit"]()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => void remove()}
                >
                  {m["release.delete"]()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {release.description && (
            <p style={{ whiteSpace: "pre-wrap" }}>{release.description}</p>
          )}
        </>
      )}

      <h3>{m["release.versions"]()}</h3>
      {swapping && (
        <p className="muted small" role="status">
          {uploadLabel(progress)}
        </p>
      )}
      {versions.length === 0 && (
        <p className="muted">{m["release.noVersions"]()}</p>
      )}
      {versions.map((v) => (
        <VersionCard
          key={v.id}
          version={v}
          label={label}
          audioUrl={`${versionAudioUrl(v.id)}?v=${bust[v.id] ?? 0}`}
          shapeOf={() => versionEnvelope(v.id)}
          trackUrl={(trackId) => versionTrackUrl(v.id, trackId)}
          download={download}
          swapping={swapping}
          onSetDefault={() => onSetDefaultVersion(v.id)}
          onReplace={() => askForFile(v.id)}
          onDelete={() => onDeleteVersion(v.id)}
          onHiddenChange={(hidden) => onSetVersionHidden(v.id, hidden)}
        />
      ))}
      <input
        ref={replaceInput}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void replacePicked(file);
        }}
      />

      <Card>
        <h3 style={{ marginTop: 0 }}>{m["release.addVersion"]()}</h3>
        <div className="row">
          <Input
            value={vName}
            placeholder={m["release.versionNamePlaceholder"]()}
            onChange={(e) => setVName(e.target.value)}
          />
          <Input
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(e) => setVFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <SwitchField
          checked={vDefault}
          onCheckedChange={setVDefault}
          className="mb-4 mt-2"
        >
          {m["release.makeDefault"]()}
        </SwitchField>
        <div>
          <Button disabled={!vFile || adding} onClick={addVersion}>
            {adding ? uploadLabel(progress) : m["release.addVersionButton"]()}
          </Button>
        </div>
      </Card>

      <p className="muted small">
        {m["release.added"]({ at: fmtDate(release.createdAt) })}
      </p>
    </div>
  );
}
