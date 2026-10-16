import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { AUDIO_ACCEPT } from "@studio/mediatek/media";
import { useState } from "react";
import {
  ReleaseFields,
  type ReleaseFieldValues,
} from "../components/ReleaseFields";
import { m } from "../paraglide/messages.js";
import type { Release } from "../types";

interface SaveData extends ReleaseFieldValues {
  versionName: string;
  audio: File;
}

interface Props {
  onSave: (data: SaveData) => Promise<Release>;
  onCancel: () => void;
}

export function ReleaseFormView({ onSave, onCancel }: Props) {
  const [values, setValues] = useState<ReleaseFieldValues>({
    title: "",
    artist: "",
    releaseDate: "",
    description: "",
    canDownload: false,
  });
  const [versionName, setVersionName] = useState<string>(() =>
    m["release.versionN"]({ n: 1 }),
  );
  const [audio, setAudio] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!values.title.trim() || !values.artist.trim() || !audio) {
      setError(m["release.newRequired"]());
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: values.title.trim(),
        artist: values.artist.trim(),
        releaseDate: values.releaseDate,
        description: values.description.trim(),
        canDownload: values.canDownload,
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

      <ReleaseFields values={values} onChange={setValues}>
        <Field label={m["release.firstVersionLabel"]()}>
          <Input
            value={versionName}
            onChange={(e) => setVersionName(e.target.value)}
          />
        </Field>

        <Field label={m["release.audioLabel"]()}>
          <Input
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
          />
        </Field>
      </ReleaseFields>

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
