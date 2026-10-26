// dock.tsx — one place at the foot of a host's frame where every mini player inside it is drawn,
// whatever page mounted it: the bar is portaled into the outlet and takes the dock's edge slots.
// A `standby` bar fills the outlet while nothing else is docked, so the row never comes and goes.
// See ../docs/miniPlayer.md, "The dock".

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

interface Dock {
  /** The outlet's element, null until it mounts — a docked bar draws nothing meanwhile. */
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
  /** How many bars other than the standby one are mounted. */
  docked: number;
  register: () => () => void;
  lead?: ReactNode;
  end?: ReactNode;
}

const DockContext = createContext<Dock | null>(null);

/** The dock's provider, above every page that may mount a bar and above the outlet. */
export function MiniPlayerDock({
  lead,
  end,
  children,
}: {
  /** The left edge of whichever bar is docked: the host's way back, for instance. */
  lead?: ReactNode;
  /** After the bar's `trail`: the host's engine, for instance. */
  end?: ReactNode;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [docked, setDocked] = useState(0);
  const register = useCallback(() => {
    setDocked((n) => n + 1);
    return () => setDocked((n) => n - 1);
  }, []);
  const value = useMemo(
    () => ({ target, setTarget, docked, register, lead, end }),
    [target, docked, register, lead, end],
  );
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

/** Where the docked bars are drawn: the host's last row, under its sidebar and its page alike. */
export function MiniPlayerDockOutlet() {
  const dock = useContext(DockContext);
  return <div ref={dock?.setTarget} className="flex shrink-0 flex-col" />;
}

/** Whether a bar mounted here is drawn in a dock rather than where it stands — for a page that leaves room for it. */
export function useMiniPlayerDocked(): boolean {
  return useContext(DockContext) !== null;
}

/** The dock as a mini player sees it: whether to draw, where, and the slots it lends. */
export function useDockSlot(standby: boolean) {
  const dock = useContext(DockContext);
  const register = dock?.register;
  useLayoutEffect(() => {
    if (!register || standby) return;
    return register();
  }, [register, standby]);
  if (!dock) return { docked: false as const };
  return {
    docked: true as const,
    target: dock.target,
    // The standby bar steps aside the moment a real one is mounted.
    hidden: standby && dock.docked > 0,
    lead: dock.lead,
    end: dock.end,
  };
}
