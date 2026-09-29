// App.tsx — the page under the studio apps. With a studio connected an app covers it, full screen
// (AppViewsPlugin.kt): st0 first, the others reached through each app's own switch, and this phone's
// engine settings inside st0's. The page shows itself — the tray — only while there is no studio to
// open, or while the one that is open does not load: then no app is there to reach settings in.

import { Button } from "@frediverse/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AppId,
  AppViews,
  St0Engine,
  type SupervisorState,
} from "./native";
import { appUrls, pickStudio, rememberStudio, studioOrigins } from "./studios";
import { Tray } from "./Tray";

export function App() {
  const [state, setState] = useState<SupervisorState | null>(null);
  const [engineExit, setEngineExit] = useState<number | null>(null);
  const [shown, setShown] = useState<AppId>("st0");
  const [failed, setFailed] = useState<{ id: AppId; message: string } | null>(
    null,
  );
  // A link from one app to another: the URL the next `show` of that app loads.
  const pendingUrl = useRef<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const choose = useCallback((origin: string) => {
    rememberStudio(origin);
    setChosen(origin);
    setFailed(null);
  }, []);

  useEffect(() => {
    const handles = [
      St0Engine.addListener("state", setState),
      St0Engine.addListener("engineExit", ({ code }) => setEngineExit(code)),
      AppViews.addListener("navigate", ({ id, url }) => {
        pendingUrl.current = url;
        setShown(id);
      }),
      AppViews.addListener("studio", ({ origin }) => choose(origin)),
      AppViews.addListener("loadError", setFailed),
    ];
    // After the listeners: a frame between the two calls is then drawn twice rather than missed.
    St0Engine.getState().then((known) => {
      if (known.state) setState(known.state);
      if (known.engineExit != null) setEngineExit(known.engineExit);
    });
    return () => {
      for (const h of handles) h.then((l) => l.remove());
    };
  }, [choose]);

  const origins = useMemo(() => studioOrigins(state?.instances), [state]);
  const studio =
    chosen && origins.includes(chosen) ? chosen : pickStudio(origins);
  const apps = useMemo(() => (studio ? appUrls(studio) : null), [studio]);

  // Another studio is another chance: what failed was the one before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the studio changing IS the signal.
  useEffect(() => setFailed(null), [studio]);

  useEffect(() => {
    if (!apps || !studio || failed) {
      AppViews.hideAll();
      return;
    }
    const url = pendingUrl.current ?? undefined;
    pendingUrl.current = null;
    AppViews.show({ id: shown, apps, studio, url });
  }, [shown, apps, studio, failed]);

  const retry = () => {
    if (failed) AppViews.reload({ id: failed.id });
    setFailed(null);
  };

  return (
    <div className="min-h-dvh bg-background pt-[var(--safe-top)] text-foreground">
      {failed ? (
        <section className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 pt-6">
          <p className="text-destructive text-sm">
            {failed.id} did not load: {failed.message}
          </p>
          <Button className="self-start" onClick={retry}>
            Retry
          </Button>
        </section>
      ) : null}
      <Tray state={state} engineExit={engineExit} />
    </div>
  );
}
