// Settings.tsx — everything the menu-bar icon used to carry, on a page. Reached at
// `/@settings`, and ONLY where st0 is served by the desktop app: `/desktop/state` exists
// nowhere else, so the hosted build never offers it. See apps/studio-desktop/docs/settings.md.
//
// It polls rather than subscribing. The supervisor already publishes only on change, and a
// second a screen like this is late is a second nobody notices — where a socket would be a
// reconnect policy nobody asked for.

import { AppHeader } from "@frediverse/ui/app-header";
import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type DesktopState, desktop, type LocalAction } from "../desktop";
import { EngineSection } from "./EngineSection";
import { MachineSection } from "./MachineSection";
import { SessionsSection } from "./SessionsSection";

/** Often enough that a click feels answered, rarely enough that an idle screen costs nothing. */
const POLL_MS = 1000;

export function Settings() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await desktop.state();
    if (s) setState(s);
    else setGone(true);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // A command's ANSWER is the next snapshot, so the refresh IS the feedback.
  const send = useCallback(
    (cmd: HostCommandName, arg?: string) => {
      void desktop.command(cmd, arg).then(() => refresh());
    },
    [refresh],
  );

  const local = useCallback(
    (what: LocalAction, arg?: string) => {
      void desktop.local(what, arg).then((r) => {
        setNote(r.ok ? null : (r.error ?? "that did not work"));
        void refresh();
      });
    },
    [refresh],
  );

  if (gone) {
    return (
      <Shell>
        <p className="text-neutral-400 text-sm">
          These settings belong to the desktop app. This looks like the hosted
          studio, which has no engine of its own to configure.
        </p>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <Loader2 className="size-4 animate-spin text-neutral-500" />
      </Shell>
    );
  }

  return (
    <Shell>
      {note && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-amber-300 text-sm">
          {note}
        </p>
      )}
      <EngineSection state={state} send={send} />
      <SessionsSection state={state} send={send} />
      <MachineSection state={state} send={send} local={local} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950">
      <AppHeader title="studio" />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <a
          href="/"
          className="flex w-fit items-center gap-1.5 text-neutral-400 text-sm hover:text-neutral-200"
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </a>
        <h1 className="font-medium text-lg text-neutral-100">Settings</h1>
        {children}
      </main>
    </div>
  );
}
