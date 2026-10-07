import { AppHeader } from "@frediverse/ui/app-header";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Volume2 } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { AccountMenu } from "../components/AccountMenu";
import { f } from "../lib/api";
import { useMonitorState } from "../lib/monitor";
import { createMonitorSystem } from "../lib/system";
import { AudioPanel, MicPanel, Panel } from "./panels";
import { BuzzersPanel, PlayersPanel, TrafficPanel } from "./sessionPanels";

// Mounted only once the auth gate has passed, which is what starts the monitor.

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

function timeNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function MonitorView() {
  const [sys] = useState(createMonitorSystem);
  const mon = useMonitorState(sys.monitor);

  const [needsGesture, setNeedsGesture] = useState(true);
  const [clock, setClock] = useState(timeNow);

  useEffect(() => {
    sys.start();
    const clockInterval = window.setInterval(() => setClock(timeNow()), 1000);
    return () => {
      window.clearInterval(clockInterval);
      sys.stop();
    };
  }, [sys]);

  async function dismissGesture() {
    sys.audio.preloader.resumeContext();
    setNeedsGesture(false);
    try {
      const r = await f("/api/game", { cache: "no-store" });
      if (!r.ok) return;
      const info = await r.json();
      if (info.phase === "song" && info.currentItem) {
        await sys.audio.recover(info.currentItem, info.categorySongs);
      }
    } catch (e) {
      console.error("recover failed:", e);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Escape and outside clicks are refused: neither unlocks audio, and a leaked click could press a buzzer. */}
      <Dialog open={needsGesture}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle>Enable audio</DialogTitle>
            <DialogDescription>
              The browser plays nothing until this page has been clicked once.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => void dismissGesture()}>
              <Volume2 className="size-4" />
              Enable audio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppHeader
        title="z0 monitor"
        version={VERSION}
        subtitle={
          <span className="font-mono" title="websocket">
            {mon.wsURL || "—"}
          </span>
        }
        actions={
          <div className="flex items-center gap-3">
            {mon.connected ? (
              <Badge className="bg-green/15 text-green">connected</Badge>
            ) : (
              <Badge variant="rec">disconnected</Badge>
            )}
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {VERSION}
            </span>
            <span className="font-mono text-sm tabular-nums">{clock}</span>
            <AccountMenu />
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-3 p-3">
        <TrafficPanel mon={mon} />

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
          <div className="grid grid-cols-2 gap-3">
            <Panel title="Phase">
              <div className="text-center text-xl font-bold tracking-widest">
                {mon.phase ? mon.phase.toUpperCase() : "—"}
              </div>
            </Panel>
            <Panel title="Current song">
              <div className="break-words text-sm">{mon.song || "—"}</div>
            </Panel>
          </div>
          <AudioPanel sys={sys} />
          <MicPanel sys={sys} />
          <BuzzersPanel sys={sys} />
          <PlayersPanel mon={mon} />
        </aside>
      </main>
    </div>
  );
}
