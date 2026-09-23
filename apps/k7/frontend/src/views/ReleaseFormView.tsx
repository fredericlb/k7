import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { Textarea } from "@frediverse/ui/textarea";
import { useState } from "react";
import { SwitchField } from "../components/SwitchField";
import { m } from "../paraglide/messages.js";
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
  const [versionName, setVersionName] = useState<string>(() =>
    m["release.versionN"]({ n: 1 }),
  );
  const [audio, setAudio] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !artist.trim() || !audio) {
      setError(m["release.newRequired"]());
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
        versionName: versionName.trim() || m["release.versionN"]({ n: 1 }),
        audio,
      });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h2>{m["release.new"]()}</h2>

      <Field label={m["field.title"]()}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <Field label={m["field.artist"]()}>
        <Input value={artist} onChange={(e) => setArtist(e.target.value)} />
      </Field>

      <Field label={m["release.dateLabel"]()}>
        <Input
          type="date"
          value={releaseDate}
          onChange={(e) => setReleaseDate(e.target.value)}
        />
      </Field>

      <Field label={m["release.descriptionLabel"]()}>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <Field label={m["release.firstVersionLabel"]()}>
        <Input
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
        />
      </Field>

      <Field label={m["release.audioLabel"]()}>
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
        {m["release.allowDownload"]()}
      </SwitchField>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button disabled={saving} onClick={submit}>
          {saving ? m["common.uploading"]() : m["release.create"]()}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m["common.cancel"]()}
        </Button>
      </div>
    </Card>
  );
}
