import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Checkbox } from "@frediverse/ui/checkbox";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import type { Page, Release } from "../types";

interface Props {
  releases: Release[];
  onSave: (data: { nametag: string; releaseIds: string[] }) => Promise<Page>;
  onCancel: () => void;
}

export function PageFormView({ releases, onSave, onCancel }: Props) {
  const [nametag, setNametag] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!/^[A-Za-z0-9]+$/.test(nametag)) {
      setError("Nametag must be alphanumeric with no spaces.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ nametag, releaseIds: [...selected] });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Card className="release-form">
      <h2>New page</h2>

      <Field label="Nametag (letters and numbers, no spaces)">
        <Input
          value={nametag}
          placeholder="e.g. summerdemos"
          onChange={(e) => setNametag(e.target.value)}
        />
      </Field>

      <div className="mb-3.5">
        <span className="mb-1.5 block text-[13px] text-muted-foreground">
          Releases on this page
        </span>
        {releases.length === 0 && (
          <p className="muted small">No releases yet — create some first.</p>
        )}
        <ul className="check-list">
          {releases.map((r) => (
            <li key={r.id}>
              <label className="my-1 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                />
                <span>
                  {r.title} <span className="muted">· {r.artist}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button disabled={saving} onClick={submit}>
          {saving ? "Creating…" : "Create page"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
