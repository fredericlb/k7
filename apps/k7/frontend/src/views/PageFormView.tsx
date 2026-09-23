import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import { SwitchField } from "../components/SwitchField";
import { m } from "../paraglide/messages.js";
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
      setError(m["page.nametagInvalid"]());
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
      <h2>{m["page.new"]()}</h2>

      <Field label={m["page.nametagLabel"]()}>
        <Input
          value={nametag}
          placeholder={m["page.nametagPlaceholder"]()}
          onChange={(e) => setNametag(e.target.value)}
        />
      </Field>

      <div className="mb-3.5">
        <span className="mb-1.5 block text-[13px] text-muted-foreground">
          {m["page.releasesOnPage"]()}
        </span>
        {releases.length === 0 && (
          <p className="muted small">{m["page.noReleasesYet"]()}</p>
        )}
        <ul className="check-list">
          {releases.map((r) => (
            <li key={r.id}>
              <SwitchField
                checked={selected.has(r.id)}
                onCheckedChange={() => toggle(r.id)}
                className="my-1"
              >
                {r.title} <span className="muted">· {r.artist}</span>
              </SwitchField>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button disabled={saving} onClick={submit}>
          {saving ? m["common.creating"]() : m["page.create"]()}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {m["common.cancel"]()}
        </Button>
      </div>
    </Card>
  );
}
