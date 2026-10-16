// App.tsx — the page under the studio apps. With a studio connected an app covers it, full screen
// (AppViewsPlugin.kt): k7, the one app with a view today, and this phone's engine settings inside
// its own. The page shows itself only while there is no studio to open, while the phone's own k7
// is still starting or failed to (Backend.tsx), or while the open one does not load: then no app is there to reach settings in.

import { Button } from "@frediverse/ui/button";
import { localServiceUrl } from "@studio/web-protocol/services";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackendPanel } from "./Backend";
import {
  type AppId,
  AppViews,
  type BackendStatus,
  K7Runtime,
  type SupervisorState,
} from "./native";
import { appUrls, pickStudio, rememberStudio, studioOrigins } from "./studios";
import { Tray } from "./Tray";

export function App() {
  const [state, setState] = useState<SupervisorState | null>(null);
  const [engineExit, setEngineExit] = useState<number | null>(null);
  const [backend, setBackend] = useState<BackendStatus>({ state: "starting" });
  const [shown, setShown] = useState<AppId>("k7");
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
      K7Runtime.addListener("state", setState),
      K7Runtime.addListener("engineExit", ({ code }) => setEngineExit(code)),
      AppViews.addListener("navigate", ({ id, url }) => {
        pendingUrl.current = url;
        setShown(id);
      }),
      AppViews.addListener("studio", ({ origin }) => choose(origin)),
      AppViews.addListener("loadError", setFailed),
      AppViews.addListener("backend", setBackend),
    ];
    // After the listeners: a frame between the two calls is then drawn twice rather than missed.
    K7Runtime.getState().then((known) => {
      if (known.state) setState(known.state);
      if (known.engineExit != null) setEngineExit(known.engineExit);
    });
    AppViews.backend().then(setBackend);
    return () => {
      for (const h of handles) h.then((l) => l.remove());
    };
  }, [choose]);

  const origins = useMemo(() => studioOrigins(state?.instances), [state]);
  const studio =
    chosen && origins.includes(chosen) ? chosen : pickStudio(origins);
  const apps = useMemo(() => (studio ? appUrls(studio) : null), [studio]);
  // The phone's own studio opens only once its backend answers.
  const held = studio === localServiceUrl("k7") && backend.state !== "ready";

  // Another studio, or a backend that came up, is another chance: what failed was the one before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the studio or the backend changing IS the signal.
  useEffect(() => setFailed(null), [studio, backend.state]);

  useEffect(() => {
    if (!apps || !studio || failed || held) {
      AppViews.hideAll();
      return;
    }
    const url = pendingUrl.current ?? undefined;
    pendingUrl.current = null;
    AppViews.show({ id: shown, apps, studio, url }).catch(() => {
      // A start that failed is said by `loadError` and `backend`.
    });
  }, [shown, apps, studio, failed, held]);

  const retry = () => {
    if (failed) AppViews.reload({ id: failed.id });
    setFailed(null);
  };

  return (
    <div className="min-h-dvh bg-background pt-[var(--safe-top)] text-foreground">
      <BackendPanel status={backend} />
      {failed && !held ? (
        <section className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 pt-6">
          <p className="text-destructive text-sm">
            {failed.id} did not load: {failed.message}
          </p>
          <Button className="self-start" onClick={retry}>
            Retry
          </Button>
        </section>
      ) : null}
      <Tray
        state={state}
        engineExit={engineExit}
        certFailed={!!failed?.message.includes("certificate")}
      />
    </div>
  );
}
