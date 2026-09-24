// The song's artist and title, changed in a popin from the ⋮ menu — the same two fields, and the
// same rule (neither empty), as the new-song form.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { Song } from "../types";

interface Props {
  song: Song;
  open: boolean;
  onSave: (artist: string, title: string) => Promise<void>;
  onClose: () => void;
}

export function SongEditDialog({ song, open, onSave, onClose }: Props) {
  const [artist, setArtist] = useState(song.artist);
  const [title, setTitle] = useState(song.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from the song as it is now, not from an abandoned edit.
  useEffect(() => {
    if (!open) return;
    setArtist(song.artist);
    setTitle(song.title);
    setError(null);
  }, [open, song.artist, song.title]);

  const submit = async () => {
    if (!artist.trim() || !title.trim()) {
      setError(m["song.required"]());
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(artist.trim(), title.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m["song.editTitle"]()}</DialogTitle>
        </DialogHeader>

        <Field label={m["field.artist"]()}>
          <Input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            onKeyDown={onEnter}
          />
        </Field>
        <Field label={m["field.title"]()}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onEnter}
          />
        </Field>

        {error && <p className="error">{error}</p>}

        <div className="row">
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? m["common.saving"]() : m["common.save"]()}
          </Button>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
