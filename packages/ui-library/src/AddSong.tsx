// AddSong.tsx — the one way a song enters the library, as one enters the songbook: a popin asks its
// artist and title, then where its audio comes from — a file uploaded, the automatic Soulseek download,
// or none at all. One song at a time. The names the user typed are what file it, whichever way is
// chosen, so the three land in the same folder. See ../docs/library.md, "Adding a song".

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Download, FileX, Loader2, Plus, Upload } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import { useRef, useState } from "react";
import { hunt, library, SongExists } from "./api";
import { readsThisMachine } from "./config";
import { HuntProgress } from "./HuntProgress";
import { useLabels } from "./host";

/** Where the popin stands: naming the song, choosing its audio, then following the way chosen. */
type Step =
  | { kind: "names" }
  | { kind: "how" }
  | {
      kind: "upload";
      file: File;
      state: "sending" | "occupied" | "failed";
      progress: number;
      error?: string;
    }
  | { kind: "hunt"; first: HuntRecord };

/** What the server says of the automatic download: whether it can run, and why not. */
interface HuntAvailability {
  configured: boolean;
  reason: string | null;
  youtube: boolean;
}

export function AddSong({
  onDone,
  onCreated,
  onOpenSettings,
}: {
  onDone: () => void;
  /** The song just added, by its folder (mediatek-relative): the screen opens its page. */
  onCreated: (folder: string) => void;
  /** Where an unconfigured download is fixed: the instance's slskd settings. */
  onOpenSettings?: () => void;
}) {
  const labels = useLabels();
  const l = labels.addSong;
  const find = labels.find;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [step, setStep] = useState<Step>({ kind: "names" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<HuntAvailability | null>(
    null,
  );
  const [huntStatus, setHuntStatus] = useState<HuntRecord["status"] | null>(
    null,
  );
  // The upload in flight, so Cancel cuts it rather than waiting on 500 MB nobody wants any more.
  const sending = useRef<AbortController | null>(null);

  const names = { artist: artist.trim(), title: title.trim() };
  const named = Boolean(names.artist && names.title);

  const start = () => {
    setArtist("");
    setTitle("");
    setStep({ kind: "names" });
    setError(null);
    setHuntStatus(null);
    setOpen(true);
    // Asked on opening: by the time the names are typed, the download says whether it can run.
    setAvailability(null);
    void hunt
      .list()
      .then((x) =>
        setAvailability({
          configured: x.configured,
          reason: x.configured ? null : x.reason,
          youtube: x.youtube,
        }),
      )
      .catch((e: Error) =>
        setAvailability({
          configured: false,
          reason: e.message,
          youtube: false,
        }),
      );
  };

  const close = () => {
    sending.current?.abort();
    setOpen(false);
  };

  /** Send the file under the names typed; `replace` overwrites the song already filed there. */
  const upload = async (file: File, replace: boolean) => {
    const ctl = new AbortController();
    sending.current = ctl;
    setError(null);
    setStep({ kind: "upload", file, state: "sending", progress: 0 });
    try {
      // No album: a song named by hand is filed where the songbook files one, under the unknown album.
      const added = await library.addSong(
        file,
        { ...names, album: "" },
        {
          replace,
          signal: ctl.signal,
          onProgress: (progress) =>
            setStep((s) => (s.kind === "upload" ? { ...s, progress } : s)),
        },
      );
      // Analysed after, never awaited — the first surface that needs it computes it anyway.
      void library
        .analyse(added.master)
        .then(onDone)
        .catch(() => {});
      onDone();
      setOpen(false);
      onCreated(added.path);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setStep(
        e instanceof SongExists
          ? { kind: "upload", file, state: "occupied", progress: 0 }
          : {
              kind: "upload",
              file,
              state: "failed",
              progress: 0,
              error: (e as Error).message,
            },
      );
    } finally {
      sending.current = null;
    }
  };

  /** The automatic download, filed under the names typed rather than under whatever a peer called it. */
  const download = () => {
    setBusy(true);
    setError(null);
    void hunt
      .start(`${names.artist} ${names.title}`, names)
      .then((first) => {
        setHuntStatus(first.status);
        setStep({ kind: "hunt", first });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  /** The song with no audio at all: its folder and its names, which a later upload fills. */
  const withoutAudio = () => {
    setBusy(true);
    setError(null);
    void library
      .addSongWithoutAudio(names)
      .then((song) => {
        onDone();
        setOpen(false);
        onCreated(song.path);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  /** Stop a running download; a song already filed stays filed. */
  const stopHunt = (id: string) => {
    void hunt.forget(id).catch(() => {});
    setStep({ kind: "how" });
  };

  const field = (
    id: string,
    label: string,
    placeholder: string,
    value: string,
    set: (v: string) => void,
    autoFocus = false,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`add-song-${id}`}>{label}</Label>
      <Input
        id={`add-song-${id}`}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && named) setStep({ kind: "how" });
        }}
      />
    </div>
  );

  const choice = (
    icon: React.ReactNode,
    label: string,
    hint: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );

  const unavailable = availability && !availability.configured;
  const description =
    step.kind === "names"
      ? l.hint
      : step.kind === "hunt"
        ? l.background
        : `${names.artist} — ${names.title}`;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>
        <Plus className="mr-1 h-3.5 w-3.5" /> {l.button}
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared at once, or re-picking the same file after an error emits no change.
          e.target.value = "";
          if (!file) return;
          if (!isAudio(file.name)) setError(l.notAudio(file.name));
          else void upload(file, false);
        }}
      />

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{l.button}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {step.kind === "names" && (
            <div className="flex flex-col gap-3">
              {field(
                "artist",
                l.artist,
                l.artistPlaceholder,
                artist,
                setArtist,
                true,
              )}
              {field("title", l.title, l.titlePlaceholder, title, setTitle)}
            </div>
          )}

          {step.kind === "how" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{l.how}</p>
              {choice(
                <Upload className="h-4 w-4" />,
                l.upload,
                l.uploadHint,
                () => input.current?.click(),
              )}
              {choice(
                availability ? (
                  <Download className="h-4 w-4" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ),
                l.download,
                l.downloadHint,
                download,
                !availability?.configured,
              )}
              {/* Said rather than hidden: an unconfigured download is a normal state of a deployment. */}
              {unavailable && availability?.reason && (
                <div className="flex items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  <span>{availability.reason}</span>
                  {/* Another server's slskd is its admins', set on that server's own page. */}
                  {readsThisMachine() && onOpenSettings && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        onOpenSettings();
                      }}
                    >
                      {find.settings}
                    </Button>
                  )}
                </div>
              )}
              {choice(
                <FileX className="h-4 w-4" />,
                l.noAudio,
                l.noAudioHint,
                withoutAudio,
              )}
            </div>
          )}

          {step.kind === "upload" && (
            <div className="flex flex-col gap-2">
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                {step.file.name}
              </code>
              {step.state === "sending" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <progress
                    className="h-1.5 flex-1 accent-primary"
                    max={1}
                    value={step.progress}
                    aria-label={l.uploading(Math.round(step.progress * 100))}
                  />
                  <span className="shrink-0 tabular-nums" aria-live="polite">
                    {step.progress < 1
                      ? l.uploading(Math.round(step.progress * 100))
                      : l.filing}
                  </span>
                </div>
              )}
              {step.state === "occupied" && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">
                  {l.occupied}
                </div>
              )}
              {step.state === "failed" && step.error && (
                <code className="block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
                  {step.error}
                </code>
              )}
            </div>
          )}

          {step.kind === "hunt" && (
            <HuntProgress
              first={step.first}
              youtube={availability?.youtube ?? false}
              onFiled={(folder) => {
                onDone();
                // Filed while watched: its page, as for the other two ways.
                if (folder) {
                  setOpen(false);
                  onCreated(folder);
                }
              }}
              onStatus={setHuntStatus}
            />
          )}

          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            {step.kind === "names" && (
              <>
                <Button variant="secondary" onClick={close}>
                  {labels.common.cancel}
                </Button>
                <Button
                  disabled={!named}
                  onClick={() => setStep({ kind: "how" })}
                >
                  {l.next}
                </Button>
              </>
            )}
            {step.kind === "how" && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setStep({ kind: "names" })}
              >
                {labels.common.back}
              </Button>
            )}
            {step.kind === "upload" &&
              (step.state === "sending" ? (
                <Button variant="secondary" onClick={close}>
                  {l.cancelUpload}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setStep({ kind: "how" })}
                  >
                    {l.otherWay}
                  </Button>
                  {step.state === "occupied" && (
                    <Button onClick={() => void upload(step.file, true)}>
                      {l.replace}
                    </Button>
                  )}
                </>
              ))}
            {step.kind === "hunt" && (
              <>
                {huntStatus === "failed" && (
                  <Button
                    variant="secondary"
                    onClick={() => setStep({ kind: "how" })}
                  >
                    {l.otherWay}
                  </Button>
                )}
                {(huntStatus === "searching" ||
                  huntStatus === "downloading") && (
                  <Button
                    variant="secondary"
                    onClick={() => stopHunt(step.first.id)}
                  >
                    {find.abandon}
                  </Button>
                )}
                <Button onClick={close}>{l.close}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
