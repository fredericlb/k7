// The host's remote: session choice, judging, scoring — but never a phase, which the server owns.
// This file is the gates and the frame; the tabs, dialogs and the controller live beside it.

import { Alert, AlertTitle } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { LockOpen, ShieldAlert } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { Splash } from "@frediverse/ui/splash";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { TooltipProvider } from "@frediverse/ui/tooltip";
import { SessionPicker } from "z0-shared/session-picker";
import { AuthBadge } from "../components/AuthBadge";
import { LoginGate } from "../components/LoginGate";
import { useAuth } from "../lib/auth";
import { m } from "../paraglide/messages.js";
import { PHASE_LABELS, type RemoteTab } from "../remote/state";
import { type Remote, useRemote } from "../remote/useRemote";
import { ControlsTab } from "./ControlsTab";
import { RemoteDialogs } from "./RemoteDialogs";
import { BuzzersTab, ManualTab } from "./ScoringTabs";
import { SetupTab } from "./SetupTab";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

const TAB_CONTENT = "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto";

export function RemoteView() {
  const { status: authStatus, error: authError, user: authUser } = useAuth();
  const r = useRemote();

  if (authStatus === "unauthenticated") return <LoginGate />;
  if (authStatus === "error")
    return <LoginGate message={authError || "auth error"} />;
  if (authStatus === "loading")
    return (
      <Splash label={m["remote.phases.loading"]()} className="bg-background" />
    );
  if (!authUser?.isAdmin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
        <Alert variant="destructive" className="max-w-sm">
          <ShieldAlert />
          <AlertTitle>ACCESS DENIED — admin only</AlertTitle>
        </Alert>
        <AuthBadge />
      </div>
    );
  }

  return <RemoteScreen r={r} />;
}

function RemoteScreen({ r }: { r: Remote }) {
  const { g, render } = r;
  const phaseLabel = PHASE_LABELS[g.gamePhase]?.() ?? g.gamePhase.toUpperCase();
  const sessionPicker = (
    <SessionPicker
      sessions={g.sessions}
      activeId={g.activeSessionId}
      loading={g.sessionsLoading}
      error={g.sessionsError}
      selecting={g.sessionSelecting}
      progress={g.sessionProgress}
      onSelect={(id) => void r.a.selectSession(id)}
      onRefresh={() => void r.a.refreshSessions()}
    />
  );
  const tabs: [RemoteTab, string][] = [
    ["controls", m["remote.tabs.ctrl"]()],
    ["manual", m["remote.tabs.manual"]()],
    ["players", m["remote.tabs.setup"]()],
    ["buzzers", m["remote.tabs.buzz"]()],
  ];

  return (
    <TooltipProvider>
      <AuthBadge />
      <div
        className="fixed inset-0 flex select-none flex-col gap-2.5 overflow-hidden bg-background p-3 font-sans text-foreground"
        onTouchStart={r.ensureWakeLock}
        onMouseDown={r.ensureWakeLock}
      >
        {g.needsUnlock && <UnlockOverlay r={r} />}

        {/* The build stamp stays left in the flow: the fixed auth badge covers this row's right end. */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              r.isConnected ? "bg-green" : "animate-pulse bg-destructive",
            )}
          />
          <span className="text-sm font-semibold tracking-wider text-primary">
            {phaseLabel}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {VERSION}
          </span>
          {g.categoryName && (
            <Badge variant="amber" className="ml-auto max-w-1/2 truncate">
              {g.categoryName}
            </Badge>
          )}
        </div>

        <Tabs
          value={g.activeTab}
          onValueChange={(v) => {
            g.activeTab = v as RemoteTab;
            render();
          }}
          className="flex min-h-0 flex-1 flex-col gap-2.5"
        >
          <TabsList className="shrink-0 flex-nowrap">
            {tabs.map(([tab, label]) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="touch-manipulation py-2"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="controls" className={TAB_CONTENT}>
            <ControlsTab
              r={r}
              phaseLabel={phaseLabel}
              sessionPicker={sessionPicker}
            />
          </TabsContent>
          <TabsContent value="manual" className={TAB_CONTENT}>
            <ManualTab r={r} />
          </TabsContent>
          <TabsContent value="players" className={TAB_CONTENT}>
            <SetupTab r={r} sessionPicker={sessionPicker} />
          </TabsContent>
          <TabsContent value="buzzers" className={TAB_CONTENT}>
            <BuzzersTab r={r} />
          </TabsContent>
        </Tabs>

        <RemoteDialogs r={r} />
      </div>
    </TooltipProvider>
  );
}

// The first tap is what browsers require before the screen may be kept awake.
function UnlockOverlay({ r }: { r: Remote }) {
  const unlock = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    void r.wakeLock.acquire();
    r.g.needsUnlock = false;
    r.render();
  };
  return (
    <Button
      variant="ghost"
      className="fixed inset-0 z-[200] h-auto flex-col gap-6 rounded-none bg-background/95 text-primary hover:bg-background/95 hover:text-primary [&_svg]:size-16"
      onTouchStart={unlock}
      onMouseDown={unlock}
    >
      <LockOpen />
      <span className="text-lg tracking-widest">
        {m["remote.tapToUnlock"]()}
      </span>
    </Button>
  );
}
