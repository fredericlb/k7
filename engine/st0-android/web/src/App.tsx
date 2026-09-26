// App.tsx — the header the phone app always shows, and under it either the engine tray (this page)
// or one of the studio apps (a native WebView, AppViewsPlugin.kt). The header's buttons switch
// between them; each app keeps its view, and so its state, while another is on screen.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import { AudioWaveform } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_IDS,
  type AppId,
  AppViews,
  St0Engine,
  type SupervisorState,
} from "./native";
import { appUrls, pickStudio, rememberStudio, studioOrigins } from "./studios";
import { Tray } from "./Tray";

type Tab = AppId | "engine";

const LAST_TAB = "st0-android.tab";

function lastTab(): Tab {
  try {
    const kept = localStorage.getItem(LAST_TAB);
    if (kept === "engine" || APP_IDS.includes(kept as AppId))
      return kept as Tab;
  } catch {
    // No storage: st0, once a studio is connected.
  }
  return "st0";
}

export function App() {
  const [state, setState] = useState<SupervisorState | null>(null);
  const [engineExit, setEngineExit] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(lastTab);
  // A link from one app to another: the URL the next `show` of that tab loads.
  const pendingUrl = useRef<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    const handles = [
      St0Engine.addListener("state", setState),
      St0Engine.addListener("engineExit", ({ code }) => setEngineExit(code)),
      AppViews.addListener("navigate", ({ id, url }) => {
        pendingUrl.current = url;
        setTab(id);
      }),
    ];
    // After the listeners: a frame between the two calls is then drawn twice rather than missed.
    St0Engine.getState().then((known) => {
      if (known.state) setState(known.state);
      if (known.engineExit != null) setEngineExit(known.engineExit);
    });
    return () => {
      for (const h of handles) h.then((l) => l.remove());
    };
  }, []);

  const origins = useMemo(() => studioOrigins(state?.instances), [state]);
  const studio =
    chosen && origins.includes(chosen) ? chosen : pickStudio(origins);
  const apps = useMemo(() => (studio ? appUrls(studio) : null), [studio]);
  // Without a studio there is nothing for the app tabs to load: the tray says how to connect one.
  const shown: Tab = apps ? tab : "engine";

  const choose = useCallback((origin: string) => {
    rememberStudio(origin);
    setChosen(origin);
  }, []);

  const select = useCallback((next: Tab) => {
    pendingUrl.current = null;
    setTab(next);
    try {
      localStorage.setItem(LAST_TAB, next);
    } catch {
      // Only a convenience.
    }
  }, []);

  // The header's bottom edge, in CSS px, is where the app views start.
  const top = useCallback(
    () => Math.ceil(header.current?.getBoundingClientRect().bottom ?? 0),
    [],
  );

  useEffect(() => {
    if (shown === "engine" || !apps) {
      AppViews.hideAll();
      return;
    }
    const url = pendingUrl.current ?? undefined;
    pendingUrl.current = null;
    AppViews.show({ id: shown, top: top(), apps, url });
  }, [shown, apps, top]);

  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const watch = new ResizeObserver(() => AppViews.setTop({ top: top() }));
    watch.observe(el);
    return () => watch.disconnect();
  }, [top]);

  const engineTone =
    engineExit != null || state?.status === "error"
      ? "bg-destructive"
      : state?.status === "running"
        ? "bg-emerald-500"
        : "bg-muted-foreground";

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <AppHeader
        ref={header}
        title={null}
        className="pt-[var(--safe-top)]"
        actions={
          <Button
            variant={shown === "engine" ? "default" : "ghost"}
            size="sm"
            aria-label="Engine"
            aria-current={shown === "engine" ? "page" : undefined}
            onClick={() => select("engine")}
          >
            <AudioWaveform />
            <span className={cn("size-2 rounded-full", engineTone)} />
          </Button>
        }
      >
        <nav className="flex flex-1 items-center gap-1">
          {APP_IDS.map((id) => (
            <Button
              key={id}
              variant={shown === id ? "default" : "ghost"}
              size="sm"
              disabled={!apps}
              aria-current={shown === id ? "page" : undefined}
              onClick={() => select(id)}
            >
              {id}
            </Button>
          ))}
        </nav>
      </AppHeader>
      {shown === "engine" ? (
        <Tray
          state={state}
          engineExit={engineExit}
          studios={origins}
          studio={studio}
          onChooseStudio={choose}
        />
      ) : null}
    </div>
  );
}
