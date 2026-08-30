// Settings.tsx — everything the menu-bar icon used to carry, on a page under four tabs.
// Reached at `/@settings`, which the desktop opens as a TAB of its own — so it carries no app
// bar and no way back: the tab strip above it is both. Three of the four need the desktop app, which `/desktop/state`
// answers for; Sync does not, so the hosted studio gets that one alone rather than a wall.
// See apps/st0-desktop/docs/settings.md.
//
// It polls rather than subscribing. The supervisor already publishes only on change, and a
// second a screen like this is late is a second nobody notices — where a socket would be a
// reconnect policy nobody asked for.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import { AudioLines, Loader2, RefreshCw, Server, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type DesktopState, desktop, type LocalAction } from "../desktop";
import { AudioSection } from "./AudioSection";
import { EngineSection } from "./EngineSection";
import { MachineSection } from "./MachineSection";
import { Tabs } from "./Section";
import { ServerSection } from "./ServerSection";
import { SessionsSection } from "./SessionsSection";
import { SyncSection } from "./SyncSection";

/** Often enough that a click feels answered, rarely enough that an idle screen costs nothing. */
const POLL_MS = 1000;

/** Audio first: it is the one someone opens this screen mid-rehearsal to fix. */
const TABS = [
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "server", label: "Server", icon: Server },
  { id: "sync", label: "Sync", icon: RefreshCw },
  { id: "misc", label: "Misc", icon: Wrench },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Settings() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("audio");

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

  // Sync alone, with no strip: the deploy key is the account's and pl8 answers for it here too,
  // where the engine, the server and the machine are all things this build does not have.
  if (gone) {
    return (
      <Shell>
        <p className="text-neutral-400 text-sm">
          The engine, the server and this machine belong to the desktop app.
          This looks like the hosted studio, which has none of its own — but the
          deploy key is your account's, so it is here.
        </p>
        <SyncSection />
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
      <Tabs tabs={TABS} current={tab} onPick={setTab} />
      {/* Unmounted rather than hidden: every row is drawn from the poll, so a tab off screen
          holds nothing worth keeping and the next snapshot fills it in under a second. */}
      {tab === "audio" && (
        <>
          <EngineSection state={state} send={send} />
          <AudioSection state={state} send={send} />
          <SessionsSection state={state} send={send} />
        </>
      )}
      {tab === "server" && (
        <ServerSection state={state} send={send} local={local} />
      )}
      {tab === "sync" && <SyncSection />}
      {tab === "misc" && <MachineSection state={state} local={local} />}
    </Shell>
  );
}

/**
 * No app bar and no way back, both deliberately: this page is a TAB of its own
 * (apps/st0-desktop/docs/tabs.md), so the strip above it already names it, and a link to `/`
 * would open a second home tab beside the first rather than return to it.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="font-medium text-lg text-neutral-100">Settings</h1>
        {children}
      </main>
    </div>
  );
}
