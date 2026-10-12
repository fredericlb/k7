// PanelClose.tsx — the bottom panel's ✕, at its top left. A view with a toolbar column of its own
// (`ModeStrip`) CLAIMS it and draws it as the column's first item; with no claim the frame floats it
// over the panel's corner. The thing a reader would get wrong: the claim is counted at mount, so the
// panel never shows two ✕ and never none, whichever view the panel holds. See docs/shell.md.

import { X } from "@frediverse/ui/icons";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

interface PanelCloseApi {
  close: () => void;
  /** A toolbar takes the ✕; the function returned gives it back. */
  claim: () => () => void;
}

const Ctx = createContext<PanelCloseApi | null>(null);

/** The ✕ for a toolbar inside a bottom panel, claimed for as long as the toolbar is mounted — null anywhere else. */
export function usePanelClose(): (() => void) | null {
  const api = useContext(Ctx);
  useLayoutEffect(() => api?.claim(), [api]);
  return api?.close ?? null;
}

/** Whether this is drawn inside a bottom panel — a view that shows its toolbar only on demand shows it there, to carry the ✕. */
export const usePanelInside = (): boolean => useContext(Ctx) !== null;

export function PanelCloseFrame({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const api = useMemo(() => ({ close: onClose, claim }), [onClose, claim]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {claims === 0 && (
        <button
          type="button"
          onClick={onClose}
          title="close the panel (ui close)"
          aria-label="close the panel"
          className="absolute top-1 left-1 z-20 flex h-6 w-6 items-center justify-center rounded border border-border bg-popover/90 text-muted-foreground shadow-sm hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </Ctx.Provider>
  );
}
