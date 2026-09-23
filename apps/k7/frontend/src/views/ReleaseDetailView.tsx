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
import { useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { ReleaseEditForm } from "../components/ReleaseEditForm";
import { SwitchField } from "../components/SwitchField";
import { VersionCard } from "../components/VersionCard";
import { fmtDate } from "../format";
import type { Release, ReleasePatch, SongEnvelope } from "../types";

interface Props {
  release: Release;
  onUpdate: (patch: ReleasePatch) => Promise<void>;
  onAddVersion: (data: {
    name: string;
    isDefault: boolean;
    audio: File;
  }) => Promise<void>;
  /** Swap one version's file; its name, its stems and its place are kept. */
  onReplaceVersionAudio: (versionId: string, audio: File) => Promise<void>;
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
    try {
      await onReplaceVersionAudio(versionId, file);
      setBust((b) => ({ ...b, [versionId]: (b[versionId] ?? 0) + 1 }));
    } finally {
      setSwapping(false);
    }
  };

  const addVersion = async () => {
    if (!vFile) return;
    setAdding(true);
    try {
      await onAddVersion({
        name: vName.trim() || `Version ${(release.versions?.length ?? 0) + 1}`,
        isDefault: vDefault,
        audio: vFile,
      });
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
    if (!confirm("Delete this release and all its versions?")) return;
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
            <BackButton to="Publications" onClick={onBack} />
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
                  <Download className="size-3" /> downloadable by users
                </>
              ) : (
                "download disabled"
              )}
            </Badge>
            {/* The release's verbs in one ⋮, like a song's, so the page below is the release. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ds-button"
                  title="Release menu"
                  aria-label="Release menu"
                >
                  <EllipsisVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => void remove()}
                >
                  Delete release
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {release.description && (
            <p style={{ whiteSpace: "pre-wrap" }}>{release.description}</p>
          )}
        </>
      )}

      <h3>Versions</h3>
      {versions.length === 0 && <p className="muted">No versions yet.</p>}
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
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void replacePicked(file);
        }}
      />

      <Card>
        <h3 style={{ marginTop: 0 }}>Add a version</h3>
        <div className="row">
          <Input
            value={vName}
            placeholder="Version name (e.g. Mix 2)"
            onChange={(e) => setVName(e.target.value)}
          />
          <Input
            type="file"
            accept="audio/*"
            onChange={(e) => setVFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <SwitchField
          checked={vDefault}
          onCheckedChange={setVDefault}
          className="mb-4 mt-2"
        >
          Make this the default version
        </SwitchField>
        <div>
          <Button disabled={!vFile || adding} onClick={addVersion}>
            {adding ? "Uploading…" : "Add version"}
          </Button>
        </div>
      </Card>

      <p className="muted small">Added {fmtDate(release.createdAt)}</p>
    </div>
  );
}
