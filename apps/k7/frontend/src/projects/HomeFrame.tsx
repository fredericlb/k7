// HomeFrame.tsx — what every home page shares: whether the sidebar is folded, and the mini player's
// dock, whose bar is always there at the foot. The engine selector sits above the sidebar's user menu,
// and in the bar while the sidebar is folded. `HomeFrame` is held above the routes, so the fold
// survives a page change; `HomeShell` is each page's layout. See ../../docs/projects.md, "The home bar".

import { AudioLines, PanelLeftOpen } from "@frediverse/ui/icons";
import { MiniPlayer } from "@studio/ui-mini-player";
import {
  MiniPlayerDock,
  MiniPlayerDockOutlet,
} from "@studio/ui-mini-player/dock";
import { NewSessionButton } from "@studio/ui-rehearsal";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HomeEngine } from "../components/HomeEngine";
import { m } from "../paraglide/messages.js";
import { HomeSidebar } from "./HomeSidebar";

// Per browser: folding is a habit of this screen, not a setting of the account.
const FOLD_KEY = "k7.homeSidebarFolded";

const readFolded = (): boolean => {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
};

interface Frame {
  folded: boolean;
  setFolded: (folded: boolean) => void;
}

const FrameContext = createContext<Frame>({
  folded: false,
  setFolded: () => {},
});

export const useHomeFrame = (): Frame => useContext(FrameContext);

export function HomeFrame({ children }: { children: ReactNode }) {
  const [folded, setFoldedState] = useState(readFolded);
  const setFolded = useCallback((next: boolean) => {
    setFoldedState(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? "1" : "0");
    } catch {
      // A browser refusing storage keeps the fold for this visit only.
    }
  }, []);
  const frame = useMemo(() => ({ folded, setFolded }), [folded, setFolded]);
  // The way back to the sidebar, at the bar's left edge while the sidebar is folded away.
  const lead = folded ? (
    <button
      type="button"
      onClick={() => setFolded(false)}
      title={m["home.unfoldSidebar"]()}
      aria-label={m["home.unfoldSidebar"]()}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <PanelLeftOpen className="h-4 w-4" />
    </button>
  ) : undefined;
  // Folded, the sidebar's engine comes to the bar: the médiathèque's engine destination is what it shows.
  const end = useMemo(() => (folded ? <HomeEngine /> : undefined), [folded]);
  return (
    <FrameContext.Provider value={frame}>
      <MiniPlayerDock lead={lead} end={end}>
        {children}
      </MiniPlayerDock>
    </FrameContext.Provider>
  );
}

/** The page frame: the sidebar on the left, the page's own column on the right, the bar under both. */
export function HomeShell({
  actions,
  commands,
  mediaCounts,
  children,
}: {
  /** Drawn above the user menu, after the red dot — a page's own control, such as a refresh. */
  actions?: ReactNode;
  /** The page's command bar button, when it has a bar: the last control, right before the account. */
  commands?: ReactNode;
  /** Each media section's count, known only on the media pages, which load them. */
  mediaCounts?: Partial<Record<string, number>>;
  children: ReactNode;
}) {
  const { folded, setFolded } = useHomeFrame();
  const column = useRef<HTMLDivElement>(null);
  usePublishedColumn(column);
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        {!folded && (
          <HomeSidebar
            actions={
              <>
                {/* The take's dot, on every home page: a session starts wherever one is reading, not on the rehearsal ones alone. */}
                <NewSessionButton />
                {actions}
                {/* Right above the user menu, the sidebar's last control (../../docs/projects.md, "The home bar"). */}
                <HomeEngine inSidebar />
                {commands}
              </>
            }
            mediaCounts={mediaCounts}
            onFold={() => setFolded(true)}
          />
        )}
        {/* `contain: layout` holds a page's fixed docks and pop-ins inside its column, clear of the sidebar and the bar. */}
        <div
          ref={column}
          className="flex min-w-0 flex-1 flex-col [contain:layout]"
        >
          {children}
        </div>
      </div>
      {/* The mini player of whichever page plays, else the standby bar: always there, the whole width, docked by `HomeFrame`. */}
      <MiniPlayerDockOutlet />
      <MiniPlayer
        standby
        icon={AudioLines}
        title={m["home.nothingPlaying"]()}
        playing={false}
        position={0}
        duration={0}
        mediaSession={false}
        labels={{
          region: m["home.player"](),
          play: m["transport.play"](),
          pause: m["transport.pause"](),
          position: m["minimap.movePlayhead"](),
          close: m["common.close"](),
        }}
        onToggle={() => {}}
        onSeek={() => {}}
        transport={null}
        track={null}
      />
    </div>
  );
}

/** Where the page column is, as CSS variables, for what is fixed OUTSIDE it: the rehearsal take, held above the routes. */
function usePublishedColumn(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const publish = () => {
      const r = el.getBoundingClientRect();
      root.setProperty("--host-column-left", `${r.left}px`);
      root.setProperty(
        "--host-column-bottom",
        `${window.innerHeight - r.bottom}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      root.removeProperty("--host-column-left");
      root.removeProperty("--host-column-bottom");
    };
  }, [ref]);
}
