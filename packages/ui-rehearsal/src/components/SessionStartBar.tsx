// SessionStartBar.tsx — what a session says while it starts, in the recorder's bar where the take will run:
// the source was picked at the New session button (this device, or the account's rehearsal chain), so it
// only says what it opens, how far it is, and why it failed. Never a dialog. See ../../docs/chainSource.md.

import { Button } from "@frediverse/ui/button";
import { Loader2 } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

interface Props {
  /** Where the start stands, in words. */
  status: string;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export function SessionStartBar({ status, error, onRetry, onClose }: Props) {
  return (
    <section className="rec-bar" aria-label={m["rec.newSession"]()}>
      <div className="rec-bar-main">
        <div className="rec-bar-wave">
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : (
            <p className="muted" role="status">
              <Loader2 className="inline size-4 animate-spin" /> {status}
            </p>
          )}
        </div>
        <div className="rec-bar-actions">
          {error && (
            <Button size="sm" onClick={onRetry}>
              {m["source.retry"]()}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {m["chain.cancel"]()}
          </Button>
        </div>
      </div>
    </section>
  );
}
