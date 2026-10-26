// SongTagsForm.tsx — a song's title, artist, album, tempo and key, edited where they live: the
// master's own tags. Written as you type, like every editor here; the folder never moves, since
// it is only the song's address (packages/mediatek/docs/songs.md, ../docs/songPlayer.md).

import { Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import type { MasterTags } from "@studio/mediatek/types";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { useCallback, useEffect, useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import { SaveState } from "./SaveState";

/** The form's buffer: every field a string, so an emptied one is `""` — which clears the tag. */
interface TagForm {
  title: string;
  artist: string;
  album: string;
  bpm: string;
  key: string;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEYS = NOTES.flatMap((n) => [`${n} major`, `${n} minor`]);
// Radix refuses an item whose value is "", so "no key" needs a word of its own.
const NO_KEY = "-";

const toForm = (t: MasterTags): TagForm => ({
  title: t.title ?? "",
  artist: t.artist ?? "",
  album: t.album ?? "",
  bpm: t.bpm ? String(t.bpm) : "",
  key: t.key ?? "",
});

const bpmOk = (s: string): boolean => {
  const n = Number(s);
  return !s.trim() || (Number.isFinite(n) && n > 0);
};

export function SongTagsForm({
  folder,
  onSaved,
  onStatus,
}: {
  /** The song's folder, mediatek-relative — the route finds the master in it. */
  folder: string;
  onSaved: () => void;
  onStatus: (status: string) => void;
}) {
  const labels = useLabels();
  const l = labels.song;
  const said = useRef(l);
  said.current = l;
  // Not a file: the autosave keys its held-back buffers by this, and a folder names one song.
  const path = `${folder}#tags`;
  const [form, setForm] = useState<TagForm | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let alive = true;
    setForm(null);
    void library
      .songTags(folder)
      .then(({ tags }) => {
        if (!alive) return;
        const disk = JSON.stringify(toForm(tags));
        // An edit that could not be written outlived this screen — give it back, not disk.
        const held = recallBuffer(path);
        setForm(JSON.parse(held ?? disk) as TagForm);
        setSaved(disk);
      })
      .catch((e: Error) => {
        if (!alive) return;
        onStatus(e.message);
      });
    return () => {
      alive = false;
    };
  }, [folder, path, onStatus]);

  // Read by `write` at the moment it sends, so the diff is against the last thing that landed.
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const write = useCallback(
    async (text: string) => {
      const f = JSON.parse(text) as TagForm;
      const was = JSON.parse(savedRef.current || "{}") as Partial<TagForm>;
      // Only what changed: the analysis may have seeded a tempo since this form was read.
      const patch: Partial<TagForm> = {};
      for (const k of Object.keys(f) as (keyof TagForm)[])
        if (f[k] !== was[k]) patch[k] = k === "bpm" ? f.bpm.trim() : f[k];
      await library.setSongTags(folder, patch);
      // What was SENT, not what came back: a trimmed echo would read as a new edit and write again.
      setSaved(text);
      onStatus(said.current.saved(folder));
      onSaved();
    },
    [folder, onSaved, onStatus],
  );
  const text = form ? JSON.stringify(form) : "";
  const autosave = useAutosave({
    path: form ? path : null,
    text,
    saved,
    write,
    // The only shape the inputs cannot rule out is a tempo that is not a number.
    validate: (_p, t) => {
      const ok = !t || bpmOk((JSON.parse(t) as TagForm).bpm);
      return {
        ok,
        issues: ok ? [] : [{ path: "bpm", message: said.current.bpmInvalid }],
        depth: "schema",
        malformed: false,
      };
    },
  });

  if (!form)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
        {labels.common.loading}
      </div>
    );

  const set = (k: keyof TagForm) => (v: string) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const field = (k: "title" | "artist" | "album", label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`tag-${k}`}>{label}</Label>
      <Input
        id={`tag-${k}`}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
      />
    </div>
  );

  return (
    <form
      aria-label={l.editor(folder)}
      className="flex h-full flex-col gap-4 overflow-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void autosave.flush();
      }}
    >
      {field("title", l.tagTitle)}
      {field("artist", l.tagArtist)}
      {field("album", l.tagAlbum)}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="tag-bpm">{l.tagBpm}</Label>
          <Input
            id="tag-bpm"
            inputMode="decimal"
            value={form.bpm}
            aria-invalid={!bpmOk(form.bpm)}
            onChange={(e) => set("bpm")(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tag-key">{l.tagKey}</Label>
          <Select
            value={form.key || NO_KEY}
            onValueChange={(v) => set("key")(v === NO_KEY ? "" : v)}
          >
            <SelectTrigger id="tag-key">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_KEY}>{l.noKey}</SelectItem>
              {KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {l.tagsHint}
        </p>
        <SaveState autosave={autosave} className="shrink-0" />
      </div>
    </form>
  );
}
