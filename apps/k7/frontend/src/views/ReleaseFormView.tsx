import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { Textarea } from "@frediverse/ui/textarea";
import { useState } from "react";
import { SwitchField } from "../components/SwitchField";
import type { Release } from "../types";

interface SaveData {
  title: string;
  artist: string;
  releaseDate: string;
  description: string;
  canDownload: boolean;
  versionName: string;
  audio: File;
}

interface Props {
  onSave: (data: SaveData) => Promise<Release>;
  onCancel: () => void;
}

export function ReleaseFormView({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [description, setDescription] = useState("");
  const [canDownload, setCanDownload] = useState(false);
  const [versionName, setVersionName] = useState("Version 1");
  const [audio, setAudio] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !artist.trim() || !audio) {
      setError("Title, artist and an audio file are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        artist: artist.trim(),
        releaseDate,
        description: description.trim(),
        canDownload,
        versionName: versionName.trim() || "Version 1",
        audio,
      });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h2>New release</h2>

      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <Field label="Artist">
        <Input value={artist} onChange={(e) => setArtist(e.target.value)} />
      </Field>

      <Field label="Release date (optional)">
        <Input
          type="date"
          value={releaseDate}
          onChange={(e) => setReleaseDate(e.target.value)}
        />
      </Field>

      <Field label="Description (optional)">
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <Field label="First version name">
        <Input
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
        />
      </Field>

      <Field label="Audio file (the song)">
        <Input
          type="file"
          accept="audio/*"
          onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
        />
      </Field>

      <SwitchField
        checked={canDownload}
        onCheckedChange={setCanDownload}
        className="mb-4 mt-2"
      >
        Allow users to download this release
      </SwitchField>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button disabled={saving} onClick={submit}>
          {saving ? "Uploading…" : "Create release"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
