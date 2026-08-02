import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";

interface Props {
  open: boolean;
  // Whether a device is connected at /remote; null while still checking.
  remoteAvailable: boolean | null;
  busy: boolean;
  error: string | null;
  onLocal: () => void;
  onRemote: () => void;
  onClose: () => void;
}

// Asked when starting a new session: record from this device's microphone, or
// from the device connected at /remote.
export function SessionSourceDialog({
  open,
  remoteAvailable,
  busy,
  error,
  onLocal,
  onRemote,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Where should the audio come from?
          </DialogDescription>
        </DialogHeader>

        {error && <p className="error">{error}</p>}

        <div className="source-choices">
          <Button disabled={busy} onClick={onLocal}>
            🎙 This device
          </Button>
          <Button
            variant="outline"
            disabled={busy || remoteAvailable === false}
            onClick={onRemote}
            title={
              remoteAvailable === false
                ? "No device is connected at /remote"
                : "Use the microphone of the device connected at /remote"
            }
          >
            📡 Remote device
          </Button>
        </div>

        <p className="muted small">
          {remoteAvailable === null
            ? "Checking for a remote device…"
            : remoteAvailable
              ? "A remote device is connected and ready."
              : "No remote device connected. Open /remote on another device (signed in as you) to use its microphone."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
