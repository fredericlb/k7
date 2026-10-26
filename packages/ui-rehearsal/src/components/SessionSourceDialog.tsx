import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Mic, Workflow } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  onLocal: () => void;
  onChain: () => void;
  onClose: () => void;
}

// Asked when a session starts: this device's microphone, or a chain of k7's library.
export function SessionSourceDialog({
  open,
  busy,
  error,
  onLocal,
  onChain,
  onClose,
}: Props) {
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
            disabled={busy}
            onClick={onChain}
            title={m["source.useChain"]()}
          >
            <Workflow className="size-4" /> {m["source.chain"]()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
