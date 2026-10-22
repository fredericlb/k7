// EngineShareEditor.tsx — under an engine row of the Engines card, for its OWNER only: the
// accounts it is shared with, edited as one list of emails or as everyone on this server, and the
// way to give the engine up. The server decides who may (packages/engine-registry/docs/ownership.md).

import { Button } from "@frediverse/ui/button";
import { Loader2, Share2 } from "@frediverse/ui/icons";
import { Switch } from "@frediverse/ui/switch";
import { Textarea } from "@frediverse/ui/textarea";
import { useId, useState } from "react";
import { engineShares, parseShares } from "./engineShares";
import { useLabels } from "./host";

export function EngineShareEditor({
  id,
  onGivenUp,
}: {
  id: string;
  /** The engine is no longer this account's: the card looks again. */
  onGivenUp: () => void;
}) {
  const l = useLabels().engines;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(false);
  const everyoneId = useId();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote("");
    try {
      await work();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const show = () => {
    setOpen(true);
    if (text === null)
      void run(async () => {
        const s = await engineShares.load(id);
        setText(s.shared.join("\n"));
        setEveryone(s.everyone === true);
      });
  };

  const parsed = parseShares(text ?? "");
  const save = () =>
    run(async () => {
      if (!parsed.ok) return;
      const r = await engineShares.save(id, parsed.emails, everyone);
      setText(r.shared.join("\n"));
      setEveryone(r.everyone === true);
      setNote(l.shareSaved);
    });
  const giveUp = () =>
    run(async () => {
      await engineShares.giveUp(id);
      onGivenUp();
    });

  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={show}>
        <Share2 className="mr-2 h-4 w-4" />
        {l.share}
      </Button>
    );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{l.shareHint}</p>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={everyoneId}
          checked={everyone}
          onCheckedChange={setEveryone}
          disabled={busy || text === null}
        />
        <label htmlFor={everyoneId}>{l.shareEveryone}</label>
      </div>
      <Textarea
        value={text ?? ""}
        onChange={(e) => setText(e.target.value)}
        placeholder={l.sharePlaceholder}
        disabled={busy || text === null}
        rows={3}
      />
      {!parsed.ok && (
        <p className="text-xs text-destructive">{l.notAnEmail(parsed.bad)}</p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={busy || text === null || !parsed.ok}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {l.shareSave}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {l.close}
        </Button>
        {/* Two clicks, inline: the engine has no owner here until its machine's next proven heartbeat. */}
        <Button
          variant={confirming ? "destructive" : "ghost"}
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() => (confirming ? void giveUp() : setConfirming(true))}
        >
          {confirming ? l.giveUpConfirm : l.giveUp}
        </Button>
      </div>
    </div>
  );
}
