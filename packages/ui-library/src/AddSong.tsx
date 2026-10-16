// AddSong.tsx — the add-songs button: pick one audio file or several, their tags are read in the browser,
// and each derived tree is shown BEFORE uploading, because that tree and not a file name is what decides
// where a song is filed. Several are sent one after another; a song whose folder is taken stays, with its
// own Replace, and one that failed stays with its reason. See ../docs/library.md, "Adding songs".

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2, Upload, X } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import {
  masterName,
  type SongTags,
  songFolder,
  tagsFromFilename,
} from "@studio/mediatek/song";
import { useRef, useState } from "react";
import { library, SongExists } from "./api";
import { useLabels } from "./host";

/** The file's tags, or a guess from its name: an unreadable file is a form to fill in, not an error. */
async function readTags(file: File): Promise<SongTags> {
  const guess = tagsFromFilename(file.name);
  try {
    // Dynamic import: music-metadata is heavy, for a button nobody clicks on every visit.
    const { parseBlob } = await import("music-metadata");
    const { common } = await parseBlob(file, { duration: false });
    return {
      artist: common.artist || common.albumartist || guess.artist || "",
      album: common.album || "",
      title: common.title || guess.title || "",
    };
  } catch {
    return { artist: guess.artist ?? "", album: "", title: guess.title ?? "" };
  }
}

/** One picked file on its way: its tags as edited, and where its upload stands. */
interface Item {
  id: number;
  file: File;
  tags: SongTags;
  reading: boolean;
  state: "ready" | "sending" | "occupied" | "failed";
  error?: string;
  /** The share of its bytes sent, while `sending`. */
  progress?: number;
}

type Field = "artist" | "album" | "title";

let nextId = 0;

export function AddSong({ onDone }: { onDone: () => void }) {
  const labels = useLabels();
  const l = labels.addSong;
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  // The upload in flight, so Cancel cuts it rather than waiting on 500 MB it no longer wants; also stops the queue.
  const sending = useRef<AbortController | null>(null);

  const update = (id: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const close = () => {
    sending.current?.abort();
    setItems([]);
  };

  const pick = (files: File[]) => {
    const picked: Item[] = files.map((file) => ({
      id: nextId++,
      file,
      tags: {},
      reading: true,
      state: "ready",
    }));
    setItems(picked);
    // Each one's tags as they come: a long list fills in row by row rather than all at the end.
    for (const it of picked)
      void readTags(it.file).then((tags) =>
        update(it.id, { tags, reading: false }),
      );
  };

  /** Send `it`, replacing what its folder holds when `replace`; answers whether it went. */
  const sendOne = async (
    it: Item,
    replace: boolean,
    signal: AbortSignal,
  ): Promise<boolean> => {
    update(it.id, { state: "sending", error: undefined, progress: 0 });
    try {
      const added = await library.addSong(
        it.file,
        {
          artist: it.tags.artist ?? "",
          album: it.tags.album ?? "",
          title: it.tags.title ?? "",
        },
        {
          replace,
          signal,
          onProgress: (progress) => update(it.id, { progress }),
        },
      );
      // Sent: off the list. Analysed after, never awaited — the first surface that needs it computes it anyway.
      setItems((xs) => xs.filter((x) => x.id !== it.id));
      void library
        .analyse(added.master)
        .then(onDone)
        .catch(() => {
          /* the song is filed either way; the cache is a derived thing */
        });
      return true;
    } catch (e) {
      if (signal.aborted) return false;
      if (e instanceof SongExists) update(it.id, { state: "occupied" });
      else update(it.id, { state: "failed", error: (e as Error).message });
      return false;
    }
  };

  /** Send every row still to send, one after another; with `only`, that one row, replacing when it is occupied. */
  const send = async (only?: Item) => {
    const ctl = new AbortController();
    sending.current = ctl;
    setBusy(true);
    let sent = 0;
    try {
      const queue = only
        ? [only]
        : items.filter(
            (it) => it.state !== "occupied" && isAudio(it.file.name),
          );
      for (const it of queue) {
        if (ctl.signal.aborted) break;
        if (await sendOne(it, it.state === "occupied", ctl.signal)) sent++;
      }
    } finally {
      sending.current = null;
      setBusy(false);
    }
    if (sent) onDone();
  };

  // The dialog closes on its own once every row has gone; what stays is what needs a decision.
  const open = items.length > 0;
  const single = items.length === 1 ? items[0] : null;
  const reading = items.some((it) => it.reading);
  const sendable = items.filter(
    (it) => it.state !== "occupied" && isAudio(it.file.name),
  );

  const edit = (it: Item, key: Field, value: string) =>
    // The edited field aims elsewhere, so a remembered "Replace" would hit a song nobody saw.
    update(it.id, {
      tags: { ...it.tags, [key]: value },
      ...(it.state === "occupied" ? { state: "ready" } : {}),
    });

  const target = (it: Item) =>
    isAudio(it.file.name)
      ? `${songFolder(it.tags)}/${masterName(it.file.name)}`
      : "";

  const field = (it: Item, key: Field, label: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`song-${it.id}-${key}`}>{label}</Label>
      <Input
        id={`song-${it.id}-${key}`}
        value={it.tags[key] ?? ""}
        placeholder={placeholder}
        disabled={it.state === "sending"}
        onChange={(e) => edit(it, key, e.target.value)}
      />
    </div>
  );

  const status = (it: Item) => (
    <>
      {it.state === "sending" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <progress
            className="h-1.5 flex-1 accent-primary"
            max={1}
            value={it.progress ?? 0}
            aria-label={l.uploading(Math.round((it.progress ?? 0) * 100))}
          />
          <span className="shrink-0 tabular-nums" aria-live="polite">
            {(it.progress ?? 0) < 1
              ? l.uploading(Math.round((it.progress ?? 0) * 100))
              : l.filing}
          </span>
        </div>
      )}
      {!isAudio(it.file.name) && (
        // `accept` is only the picker's default filter — "all files" stays one click away.
        <div className="text-xs text-destructive">
          {l.notAudio(it.file.name)}
        </div>
      )}
      {it.state === "occupied" && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">
          {l.occupied}
        </div>
      )}
      {it.state === "failed" && it.error && (
        <code className="block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {it.error}
        </code>
      )}
    </>
  );

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => input.current?.click()}
      >
        <Upload className="mr-1 h-3.5 w-3.5" /> {l.button}
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared at once, or re-picking the same files after an error emits no change.
          e.target.value = "";
          if (files.length) pick(files);
        }}
      />

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent className={single ? "max-w-lg" : "max-w-3xl"}>
          <DialogHeader>
            <DialogTitle>
              {single ? l.button : l.many(items.length)}
            </DialogTitle>
            <DialogDescription>
              {reading ? l.readingTags : l.hint}
            </DialogDescription>
          </DialogHeader>

          {single ? (
            <>
              <div className="flex flex-col gap-3">
                {field(single, "artist", l.artist, l.artistPlaceholder)}
                {field(single, "album", l.album, l.albumPlaceholder)}
                {field(single, "title", l.title, l.titlePlaceholder)}
              </div>
              {target(single) && (
                <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {target(single)}
                </code>
              )}
              {status(single)}
            </>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    {it.state === "sending" && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                      {target(it) || it.file.name}
                    </span>
                    {it.state === "occupied" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void send(it)}
                      >
                        {l.replace}
                      </Button>
                    )}
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title={l.drop}
                      aria-label={l.drop}
                      disabled={it.state === "sending"}
                      onClick={() =>
                        setItems((xs) => xs.filter((x) => x.id !== it.id))
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {field(it, "artist", l.artist, l.artistPlaceholder)}
                    {field(it, "album", l.album, l.albumPlaceholder)}
                    {field(it, "title", l.title, l.titlePlaceholder)}
                  </div>
                  {status(it)}
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              {busy ? l.cancelUpload : labels.common.cancel}
            </Button>
            {single?.state === "occupied" ? (
              <Button onClick={() => void send(single)} disabled={busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {l.replace}
              </Button>
            ) : (
              <Button
                onClick={() => void send()}
                disabled={busy || reading || !sendable.length}
              >
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {single ? l.send : l.sendMany(sendable.length)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
