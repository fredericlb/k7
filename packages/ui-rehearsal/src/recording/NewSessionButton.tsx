// NewSessionButton.tsx — what starts a take: the red dot the host draws wherever it puts a page's own
// control, and the labelled button an empty timeline offers in its place. Both start on this device at
// once when no rehearsal chain is chosen, else open a menu of this device and that chain, and run one
// hook, so a start in progress or refused reads the same from either. See ../../docs/chainSource.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Mic, MicOff, Workflow } from "@frediverse/ui/icons";
import { type ReactNode, useState } from "react";
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

/** The account's rehearsal chain, or null; loaded on demand, the chain source carrying the engine client the sidebar must not. */
async function askRehearsalChain(): Promise<string | null> {
  try {
    const { rehearsalChain } = await import("../chainSource");
    return await rehearsalChain();
  } catch {
    return null;
  }
}

/**
 * What both buttons do: with no rehearsal chain chosen, start on this device at once; with one, open
 * the menu of this device and that chain. Asked at the click, since it is chosen on another page,
 * maybe in another tab, so Radix's own opening on pointer and key is held back until the answer.
 */
function SourceMenu({
  trigger,
  onPick,
}: {
  trigger: (asking: boolean) => ReactNode;
  onPick: (source: SessionSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [chain, setChain] = useState<string | null>(null);
  const decide = async () => {
    if (asking) return;
    setAsking(true);
    const ref = await askRehearsalChain();
    setAsking(false);
    if (!ref) return onPick("local");
    setChain(ref);
    setOpen(true);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        onPointerDown={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown")
            return;
          e.preventDefault();
          void decide();
        }}
        onClick={() => void decide()}
      >
        {trigger(asking)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rehearsal-root min-w-64">
        <DropdownMenuItem onSelect={() => onPick("local")}>
          <Mic className="size-4" /> {m["source.local"]()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("chain")}>
          <Workflow className="size-4" />
          <span className="flex min-w-0 flex-col">
            <span>{m["source.chain"]()}</span>
            <span className="truncate text-muted-foreground text-xs">
              {chain}
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
      trigger={(asking) => (
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
              className={`size-3.5 rounded-full bg-destructive${creating || asking ? " animate-pulse" : ""}`}
            />
          )}
        </Button>
      )}
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
        trigger={(asking) => (
          <Button size="sm" className="ds-button" disabled={creating || asking}>
            <Mic className="size-4" />
            {creating ? m["rec.starting"]() : m["recordings.startFirst"]()}
          </Button>
        )}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );
}
