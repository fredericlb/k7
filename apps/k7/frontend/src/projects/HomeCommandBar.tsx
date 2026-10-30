// HomeCommandBar.tsx — the home pages' command bar, held by the frame so every home page has it and a
// camera mode or an armed delete survives going from one page to another. Its vocabulary is homeCommands.ts.
// The one thing a reader would get wrong: the workspaces are read when the bar opens, not polled (../../docs/commandBar.md).

import { Button } from "@frediverse/ui/button";
import { Terminal } from "@frediverse/ui/icons";
import { deviceName } from "@studio/engine-browser/pairing";
import type { AccountWorkspace } from "@studio/web-protocol";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { CameraMode } from "../camera/CameraMode";
import type { CommandBarHandle } from "../components/CommandBar";
import {
  FloatingCommandBar,
  useSummonKey,
} from "../components/FloatingCommandBar";
import { useWindowKey } from "../hooks/useWindowKey";
import { useLocale } from "../i18n";
import { m } from "../paraglide/messages.js";
import { findAccountFiles } from "../settings/accountFiles";
import { DOUBLE_SHIFT_MS } from "../shellMeta";
import { accountFiles } from "./api";
import {
  type ArmedDelete,
  buildHomePalette,
  HOME_ACTS,
  type HomeContext,
  homeArgValues,
  runHomeCommand,
  WS_PARAM,
} from "./homeCommands";
import type { AccountFiles } from "./workspaceOps";

/** The name this device was last a camera under, so a phone on a stand keeps its name across sessions. */
const CAMERA_NAME_KEY = "k7.cameraName";

function storedCameraName(): string {
  try {
    return localStorage.getItem(CAMERA_NAME_KEY) || deviceName();
  } catch {
    return deviceName();
  }
}

interface Said {
  text: string;
  refused: boolean;
}

interface Bar {
  summon: () => void;
  said: Said | null;
  /** Called after a command wrote to the workspaces, so a page listing them reads them at once. */
  onChanged: (listener: () => void) => () => void;
}

const BarContext = createContext<Bar>({
  summon: () => {},
  said: null,
  onChanged: () => () => {},
});

/** Reload a page's own list when a command from the bar changed it. */
export function useHomeCommandsChanged(listener: () => void): void {
  const { onChanged } = useContext(BarContext);
  useEffect(() => onChanged(listener), [onChanged, listener]);
}

export function HomeCommandBar({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const openWs = params.get(WS_PARAM);
  const cmdRef = useRef<CommandBarHandle>(null);
  // Hidden until summoned, as in the editor (../../docs/commandBar.md).
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const { locale } = useLocale();
  const palette = useMemo(() => buildHomePalette(locale), [locale]);
  /** The project a `project delete init` named, awaiting its confirm — read by the next command and never drawn. */
  const armed = useRef<ArmedDelete | null>(null);
  /** The name this device is a camera under, while `camera mode` is on (../camera/CameraMode.tsx). */
  const [camera, setCamera] = useState<string | null>(null);
  const listeners = useRef(new Set<() => void>());

  // What the commands act on, read when the bar opens: a page with no project list holds none of it.
  const files = useRef<AccountFiles | null | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const readWorkspaces = useCallback(async (): Promise<HomeContext> => {
    files.current ??= await findAccountFiles(false);
    const fs = files.current;
    const list = fs ? await accountFiles.workspaces(fs).catch(() => []) : [];
    setWorkspaces(list);
    return { fileService: fs, workspaces: list, openWs };
  }, [openWs]);

  const summon = useCallback(() => {
    setOpen(true);
    cmdRef.current?.focus();
    void readWorkspaces();
  }, [readWorkspaces]);
  useSummonKey(summon);

  /** Two bare Shifts summon it too, the editor's own gesture; `e.repeat` drops a held Shift. */
  const lastShiftAt = useRef(0);
  useWindowKey((e) => {
    if (e.key !== "Shift" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) {
      lastShiftAt.current = 0;
      return;
    }
    const now = e.timeStamp;
    if (now - lastShiftAt.current <= DOUBLE_SHIFT_MS) {
      lastShiftAt.current = 0;
      summon();
    } else lastShiftAt.current = now;
  });

  const cameraMode = useCallback((name: string | null): string | null => {
    // getUserMedia exists only in a secure context: over plain http on a LAN there is nothing to open.
    if (!navigator.mediaDevices?.getUserMedia) return m["hc.noCameraHere"]();
    const chosen = name?.trim() || storedCameraName();
    try {
      if (name?.trim()) localStorage.setItem(CAMERA_NAME_KEY, chosen);
    } catch {
      // A browser that keeps nothing asks for the name again next time, which is all it costs.
    }
    setCamera(chosen);
    return null;
  }, []);

  const run = useCallback(
    async (line: string) => {
      setSaid(null);
      // Read afresh: a list from when the bar opened may miss what another tab just made.
      const ctx = await readWorkspaces();
      const known = await runHomeCommand(line, {
        ...ctx,
        acts: HOME_ACTS,
        say: (text) => setSaid({ text, refused: false }),
        refuse: (text) => setSaid({ text, refused: true }),
        changed: () => {
          for (const l of listeners.current) l();
          void readWorkspaces();
        },
        armed,
        cameraMode,
      });
      // A line these pages do not know is refused HERE: no service behind it to pass it to.
      if (!known)
        setSaid({
          text: m["home.unknownCommand"]({ line: line.trim() }),
          refused: true,
        });
    },
    [readWorkspaces, cameraMode],
  );

  const onChanged = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const bar = useMemo(
    () => ({ summon, said, onChanged }),
    [summon, said, onChanged],
  );

  return (
    <BarContext.Provider value={bar}>
      {children}
      <FloatingCommandBar
        ref={cmdRef}
        open={open}
        onDismiss={() => setOpen(false)}
        pending={pending}
        onPending={(p) => setPending(!!p)}
        commands={palette}
        listArg={async (command, prior) =>
          homeArgValues(command, prior.length, {
            fileService: files.current ?? null,
            workspaces,
            openWs,
          })
        }
        onRun={(line) => void run(line)}
      />
      {camera && <CameraMode name={camera} onStop={() => setCamera(null)} />}
    </BarContext.Provider>
  );
}

/** The bar's opener: a phone has no Ctrl+Shift+P nor double-Shift, so the bar needs a control of its own. */
export function HomeCommandsButton() {
  const { summon } = useContext(BarContext);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={summon}
      title={`${m["commandBar.list"]()} (Ctrl+Shift+P)`}
      aria-label={m["commandBar.list"]()}
    >
      <Terminal className="size-4" />
    </Button>
  );
}

/** What the bar last said, at the foot of the page's column in amber when refused; nothing while it said nothing. */
export function HomeCommandsSaid() {
  const { said } = useContext(BarContext);
  if (!said) return null;
  return (
    <p
      className={`shrink-0 truncate border-t border-border bg-popover px-3 py-1.5 text-xs ${
        said.refused ? "text-amber-500" : "text-muted-foreground"
      }`}
      title={said.text}
    >
      {said.text}
    </p>
  );
}
