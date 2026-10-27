// NewSessionButton.tsx — what starts a take: the red dot the host draws wherever it puts a page's own
// control, and the labelled button an empty timeline offers in its place. Both open one menu — this
// device, or the account's rehearsal chain — and run one hook, so a start in progress or refused reads
// the same from either. See ../../docs/chainSource.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Mic, MicOff, Workflow } from "@frediverse/ui/icons";
import { type ReactNode, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { type SessionSource, useRehearsalRecording } from "./context";

/** Start a session, holding whether one is starting and why the last start was refused. */
function useStartSession() {
  const { start } = useRehearsalRecording();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (source: SessionSource) => {
    setCreating(true);
    setError(null);
    try {
      await start(source);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };
  return { create, creating, error };
}

/** The account's rehearsal chain as the menu shows it: undefined while asked, null when none is chosen. */
function useRehearsalChain(open: boolean): string | null | undefined {
  const [chain, setChain] = useState<string | null | undefined>(undefined);
  // Asked again at every opening: the chain is chosen on another page, maybe in another tab.
  useEffect(() => {
    if (!open) return;
    let live = true;
    // Loaded on demand: the chain source carries the engine client the sidebar must not.
    void import("../chainSource")
      .then(({ rehearsalChain }) => rehearsalChain())
      .then((ref) => live && setChain(ref))
      .catch(() => live && setChain(null));
    return () => {
      live = false;
    };
  }, [open]);
  return chain;
}

/** The menu both buttons open: this device's microphone, or the chain chosen on k7's Frozen chains page. */
function SourceMenu({
  trigger,
  onPick,
}: {
  trigger: ReactNode;
  onPick: (source: SessionSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const chain = useRehearsalChain(open);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rehearsal-root min-w-64">
        <DropdownMenuItem onSelect={() => onPick("local")}>
          <Mic className="size-4" /> {m["source.local"]()}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!chain}
          onSelect={() => onPick("chain")}
          title={chain === null ? m["source.noChain"]() : undefined}
        >
          <Workflow className="size-4" />
          <span className="flex min-w-0 flex-col">
            <span>{m["source.chain"]()}</span>
            <span className="truncate text-muted-foreground text-xs">
              {chain === undefined
                ? m["source.chainReading"]()
                : (chain ?? m["source.noChainShort"]())}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NewSessionButton() {
  const { create, creating, error } = useStartSession();
  return (
    <SourceMenu
      onPick={(s) => void create(s)}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={creating}
          title={
            error ?? (creating ? m["rec.starting"]() : m["rec.newSession"]())
          }
          aria-label={m["rec.newSession"]()}
        >
          {error ? (
            <MicOff className="size-4 text-destructive" />
          ) : (
            // A recorder's red dot, pulsing while the session starts.
            <span
              aria-hidden="true"
              className={`size-3.5 rounded-full bg-destructive${creating ? " animate-pulse" : ""}`}
            />
          )}
        </Button>
      }
    />
  );
}

/** The empty timeline's act: the same start as the dot, named, where the eye already is. */
export function StartFirstSessionButton() {
  const { create, creating, error } = useStartSession();
  return (
    <>
      <SourceMenu
        onPick={(s) => void create(s)}
        trigger={
          <Button size="sm" className="ds-button" disabled={creating}>
            <Mic className="size-4" />
            {creating ? m["rec.starting"]() : m["recordings.startFirst"]()}
          </Button>
        }
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );
}
