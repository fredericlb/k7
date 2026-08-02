import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import type { Song } from "../types";

interface SaveData {
  artist: string;
  title: string;
}

interface Props {
  onSave: (data: SaveData) => Promise<Song>;
  onCancel: () => void;
}

export function SongFormView({ onSave, onCancel }: Props) {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!artist.trim() || !title.trim()) {
      setError("Artist and title are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ artist: artist.trim(), title: title.trim() });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h2>New song</h2>

      <Field label="Artist">
        <Input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>

      <Field label="Title">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button disabled={saving} onClick={submit}>
          {saving ? "Creating…" : "Create song"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
