// A release's own fields, edited in place on its page. The audio is not here: versions are
// added, replaced and hidden one by one, below it.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { Textarea } from "@frediverse/ui/textarea";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { Release, ReleasePatch } from "../types";
import { SwitchField } from "./SwitchField";

interface Props {
  release: Release;
  onSave: (patch: ReleasePatch) => Promise<void>;
  onCancel: () => void;
}

export function ReleaseEditForm({ release, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(release.title);
  const [artist, setArtist] = useState(release.artist);
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? "");
  const [description, setDescription] = useState(release.description);
  const [canDownload, setCanDownload] = useState(release.canDownload);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !artist.trim()) {
      setError(m["release.editRequired"]());
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        artist: artist.trim(),
        releaseDate: releaseDate || null,
        description: description.trim(),
        canDownload,
      });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h3 style={{ marginTop: 0 }}>{m["release.edit"]()}</h3>

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
          {saving ? m["common.saving"]() : m["common.save"]()}
        </Button>
        <Button variant="outline" disabled={saving} onClick={onCancel}>
          {m["common.cancel"]()}
        </Button>
      </div>
    </Card>
  );
}
