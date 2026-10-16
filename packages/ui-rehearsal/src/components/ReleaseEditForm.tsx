// A release's own fields, edited in place on its page. The audio is not here: versions are
// added, replaced and hidden one by one, below it.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { Release, ReleasePatch } from "../types";
import { ReleaseFields, type ReleaseFieldValues } from "./ReleaseFields";

interface Props {
  release: Release;
  onSave: (patch: ReleasePatch) => Promise<void>;
  onCancel: () => void;
}

export function ReleaseEditForm({ release, onSave, onCancel }: Props) {
  const [values, setValues] = useState<ReleaseFieldValues>({
    title: release.title,
    artist: release.artist,
    releaseDate: release.releaseDate ?? "",
    description: release.description,
    canDownload: release.canDownload,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!values.title.trim() || !values.artist.trim()) {
      setError(m["release.editRequired"]());
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: values.title.trim(),
        artist: values.artist.trim(),
        releaseDate: values.releaseDate || null,
        description: values.description.trim(),
        canDownload: values.canDownload,
      });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h3 style={{ marginTop: 0 }}>{m["release.edit"]()}</h3>

      <ReleaseFields values={values} onChange={setValues} />

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
