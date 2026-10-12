// NewSessionButton.tsx — the red dot that starts a take, drawn by the host wherever it puts a page's
// own control. Utilities only: it sits outside the `.rehearsal-root` wrapper.

import { Button } from "@frediverse/ui/button";
import { MicOff } from "@frediverse/ui/icons";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { useRehearsalRecording } from "./context";

export function NewSessionButton() {
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
