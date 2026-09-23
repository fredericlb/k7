// PageNametagForm.tsx — "Edit" on a page: the nametag is the one thing a page has to edit, and it is
// also its public address, so renaming it breaks every link already handed out.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";

interface Props {
  nametag: string;
  onSave: (nametag: string) => Promise<void>;
  onCancel: () => void;
}

export function PageNametagForm({ nametag, onSave, onCancel }: Props) {
  const [value, setValue] = useState(nametag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The same rule as creating a page, and as the backend's.
    if (!/^[A-Za-z0-9]+$/.test(value)) {
      setError("Nametag must be alphanumeric with no spaces.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="row">
        <Input
          aria-label="Nametag"
          className="max-w-64"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="muted small">
        The nametag is the public link: renaming it breaks the old one.
      </p>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
