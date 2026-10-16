import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Mic, RadioTower, Workflow } from "@frediverse/ui/icons";
import { useRehearsalNav } from "../host";
import { m } from "../paraglide/messages.js";

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

// Asked when a session starts: this device's microphone, the one at the remote page, or a chain of k7's library.
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
  // What to TYPE on the phone: the rehearsal pages' own /remote, under the host's prefix.
  const remotePath = useRehearsalNav().path("/remote");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="rehearsal-root sm:max-w-md">
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
                ? m["source.noDeviceAt"]({ path: remotePath })
                : m["source.useDeviceAt"]({ path: remotePath })
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
              : m["source.none"]({ path: remotePath })}
        </p>
      </DialogContent>
    </Dialog>
  );
}
