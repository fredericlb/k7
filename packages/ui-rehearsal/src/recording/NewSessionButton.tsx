// NewSessionButton.tsx — what starts a take: the red dot the host draws wherever it puts a page's own
// control, and the labelled button an empty timeline offers in its place. Both run one hook, so a
// start in progress or refused reads the same from either. Utilities only: the dot sits outside the
// `.rehearsal-root` wrapper, the labelled one inside it as a `.ds-button`.

import { Button } from "@frediverse/ui/button";
import { Mic, MicOff } from "@frediverse/ui/icons";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { useRehearsalRecording } from "./context";

/** Start a session, holding whether one is starting and why the last start was refused. */
function useStartSession() {
  const { start } = useRehearsalRecording();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await start();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };
  return { create, creating, error };
}

export function NewSessionButton() {
  const { create, creating, error } = useStartSession();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={creating}
      onClick={create}
      title={error ?? (creating ? m["rec.starting"]() : m["rec.newSession"]())}
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
  );
}

/** The empty timeline's act: the same start as the dot, named, where the eye already is. */
export function StartFirstSessionButton() {
  const { create, creating, error } = useStartSession();
  return (
    <>
      <Button
        size="sm"
        className="ds-button"
        disabled={creating}
        onClick={create}
      >
        <Mic className="size-4" />
        {creating ? m["rec.starting"]() : m["recordings.startFirst"]()}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );
}
