import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Mic, RadioTower, Workflow } from "@frediverse/ui/icons";
import { BASE } from "../api";
import { m } from "../paraglide/messages.js";

// What to TYPE on the phone: a bare /remote is the médiathèque's — ../../../docs/routing.md.
const REMOTE_PATH = `${BASE}/remote`;

interface Props {
  open: boolean;
  // Whether a device is connected at the remote-mic page; null while checking.
  remoteAvailable: boolean | null;
  busy: boolean;
  error: string | null;
  onLocal: () => void;
  onRemote: () => void;
  onChain: () => void;
  onClose: () => void;
}

// Asked when a session starts: this device's microphone, the one at the remote page, or a chain of st0's library.
export function SessionSourceDialog({
  open,
  remoteAvailable,
  busy,
  error,
  onLocal,
  onRemote,
  onChain,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m["rec.newSession"]()}</DialogTitle>
          <DialogDescription>{m["source.question"]()}</DialogDescription>
        </DialogHeader>

        {error && <p className="error">{error}</p>}

        <div className="source-choices">
          <Button disabled={busy} onClick={onLocal}>
            <Mic className="size-4" /> {m["source.local"]()}
          </Button>
          <Button
            variant="outline"
            disabled={busy || remoteAvailable === false}
            onClick={onRemote}
            title={
              remoteAvailable === false
                ? m["source.noDeviceAt"]({ path: REMOTE_PATH })
                : m["source.useDeviceAt"]({ path: REMOTE_PATH })
            }
          >
            <RadioTower className="size-4" /> {m["source.remote"]()}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={onChain}
            title={m["source.useChain"]()}
          >
            <Workflow className="size-4" /> {m["source.chain"]()}
          </Button>
        </div>

        <p className="muted small">
          {remoteAvailable === null
            ? m["source.checking"]()
            : remoteAvailable
              ? m["source.ready"]()
              : m["source.none"]({ path: REMOTE_PATH })}
        </p>
      </DialogContent>
    </Dialog>
  );
}
