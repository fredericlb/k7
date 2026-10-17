// ProjectGate.tsx — resolve the address this app was opened on into a project on the engine's
// machine (an `@local` folder, or the bench), then open the project and render the app. No app
// picks anything here: a project is chosen on k7's home page, and arriving with no target sends
// you back there. The resolving is useGatePhase.ts, the screens GateScreens.tsx. See docs/launch.md.

import type { ProjectApp } from "@studio/web-protocol/projects";
import type { ReactNode } from "react";
import { EngineLoadScreen } from "./EngineLoadScreen.tsx";
import { GateWait } from "./GateProgress.tsx";
import {
  CloningScreen,
  EmptyWorkspaceScreen,
  ErrorScreen,
  GateSpinner,
  IdleScreen,
  MissingScreen,
  NoLibrariesScreen,
} from "./GateScreens.tsx";
import type { GateEngine, ProjectGateStrings } from "./gateTypes.ts";
import { SyncScreen, syncLine, syncOffline } from "./syncWait.tsx";
import { useGatePhase } from "./useGatePhase.ts";

/** What the bar says while the address is resolved, when the host passes no wording of its own. */
const OPENING = "Opening the project…";

export { ProjectTakenOver } from "./GateScreens.tsx";
export type { GateEngine, ProjectGateStrings } from "./gateTypes.ts";

export function ProjectGate({
  engine,
  app,
  base,
  strings,
  children,
  renderEmpty,
  renderNoLibraries,
  idleTimeoutMs = 0,
  asleep = false,
  onIdle,
  onResume,
  waits = "screens",
}: {
  engine: GateEngine;
  /** Which app this is — it decides the suffix that ends the project in the address. */
  app: ProjectApp;
  /** Where this app is mounted — vite's `import.meta.env.BASE_URL`, handed over, docs/launch.md. */
  base: string;
  /** Each app owns its own wording (k7 has paraglide); the gate translates nothing itself. */
  strings: ProjectGateStrings;
  /** Rendered once the project is open — the app itself. */
  children: (ctx: {
    workspace: string;
    project: string;
    userEmail: string;
    quit: () => void;
  }) => ReactNode;
  /**
   * What to draw for a workspace holding NO project — k7 puts its first-project wizard here.
   * `onCreated` re-runs the whole resolve, so the gate opens whatever was just made rather than
   * being told about it. Without it, a sentence and the way back. See docs/launch.md.
   */
  renderEmpty?: (ctx: {
    workspace: string;
    onCreated: () => void;
  }) => ReactNode;
  /** What to draw when the account has NO library — k7 puts the card that adds one here; `onAdded` re-runs the resolve. */
  renderNoLibraries?: (ctx: { onAdded: () => void }) => ReactNode;
  /** Close the session after this long untouched; `0` — the default — is off. See docs/idle.md. */
  idleTimeoutMs?: number;
  /** The project is out of sight — a tab behind another. Same closing, and it reopens by itself. */
  asleep?: boolean;
  /** Whatever the APP holds and the gate cannot see — k7's engine lease. See docs/idle.md. */
  onIdle?: () => void;
  /** Taking it back. Called before the reopen starts, so the app can retake what it released. */
  onResume?: () => void;
  /** `screens` draws each wait full-screen; `bar` draws it as a bar along the bottom and opens the project without waiting for the engine, which the app then reports — docs/launch.md. */
  waits?: "screens" | "bar";
}) {
  const bar = waits === "bar";
  const { phase, setPhase, email, quit, resume, retry } = useGatePhase({
    engine,
    app,
    base,
    strings,
    idleTimeoutMs,
    asleep,
    onIdle,
    onResume,
    engineWait: !bar,
  });

  if (bar && phase.k === "resolving")
    return <GateWait label={strings.opening ?? OPENING} />;
  if (bar && phase.k === "syncing")
    return (
      <GateWait
        label={syncLine(phase.sync, strings.syncing)}
        stuck={syncOffline(phase.sync)}
      />
    );
  if (bar && phase.k === "cloning")
    return (
      <GateWait
        label={[strings.cloning(phase.workspace), phase.phase]
          .filter(Boolean)
          .join(" — ")}
      />
    );

  switch (phase.k) {
    case "loading": {
      const { workspace, project } = phase;
      return (
        <EngineLoadScreen
          strings={strings.loading}
          onReady={() => setPhase({ k: "open", workspace, project })}
          onFail={(message) => setPhase({ k: "error", message })}
        />
      );
    }
    case "syncing":
      return (
        <SyncScreen
          workspace={phase.workspace}
          sync={phase.sync}
          strings={strings.syncing}
        />
      );
    case "open":
      return (
        <>
          {children({
            workspace: phase.workspace,
            project: phase.project,
            userEmail: email,
            quit,
          })}
        </>
      );
    case "cloning":
      return (
        <CloningScreen
          title={strings.cloning(phase.workspace)}
          detail={phase.phase}
        />
      );
    case "missing":
      return (
        <MissingScreen
          strings={strings}
          hint={phase.hint}
          detail={phase.detail}
          onBack={quit}
        />
      );
    case "no-libraries":
      return (
        <NoLibrariesScreen
          strings={strings}
          addOne={renderNoLibraries?.({ onAdded: resume })}
          onBack={quit}
        />
      );
    // What a first project IS — which archetype, which suffix — is the app's vocabulary, so the app draws the wizard.
    case "empty":
      return renderEmpty ? (
        renderEmpty({ workspace: phase.workspace, onCreated: resume })
      ) : (
        <EmptyWorkspaceScreen strings={strings} onBack={quit} />
      );
    case "idle":
      return <IdleScreen strings={strings} onResume={resume} onBack={quit} />;
    case "error":
      return (
        <ErrorScreen
          strings={strings}
          fault={phase.fault}
          message={phase.message}
          lines={phase.lines}
          fileBase={engine.fileBase}
          onRetry={retry}
          onBack={quit}
        />
      );
    default:
      return <GateSpinner />;
  }
}
