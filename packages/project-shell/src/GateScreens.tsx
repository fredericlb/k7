// GateScreens.tsx — the project gate's screens other than the app itself: the waits, the
// refusals, sleep and the errors. Each draws one phase and decides nothing. See docs/launch.md.

import {
  FolderGit2,
  FolderSearch,
  LibraryBig,
  Loader2,
  Moon,
  ServerCrash,
  ShieldAlert,
  UserRoundX,
} from "@frediverse/ui/icons";
import type { ReactNode } from "react";
import type { FileServiceFault } from "./fileApi.ts";
import type { ProjectGateStrings } from "./gateTypes.ts";

/** What a workspace with no project says when the app draws no wizard: nothing is wrong, it is empty. */
const EMPTY_WORKSPACE =
  "This workspace holds no project yet — add one from the projects page.";

const PRIMARY =
  "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground";
const QUIET = "rounded-md px-3 py-1.5 text-sm text-muted-foreground";

/** The one layout every gate screen shares: an icon over a centred column, `wide` for a bar to span. */
function GateCard({
  icon,
  wide,
  children,
}: {
  icon: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div
        className={`flex ${wide ? "w-full " : ""}max-w-md flex-col items-center gap-4 text-center`}
      >
        {icon}
        {children}
      </div>
    </div>
  );
}

/** The raw message behind a screen, folded away: the sentence above it is what to do, this is what to report. */
function Detail({ label, text }: { label: string; text: string }) {
  return (
    <details className="w-full max-w-full text-left text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">{label}</summary>
      <code className="mt-1 block max-w-full overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1">
        {text}
      </code>
    </details>
  );
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={PRIMARY} onClick={onClick}>
      {label}
    </button>
  );
}

/** "Somebody else opened this project" — one screen, and no Retry. See docs/launch.md. */
export function ProjectTakenOver({
  heldBy,
  title,
  body,
  back,
  onBack,
}: {
  /** Who has it now — empty when the registry could not say, in which case body carries it. */
  heldBy: string;
  title: string;
  body: (heldBy: string) => string;
  back: string;
  onBack: () => void;
}) {
  return (
    <GateCard icon={<UserRoundX className="h-10 w-10 text-amber-500" />}>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body(heldBy)}</p>
      <Back label={back} onClick={onBack} />
    </GateCard>
  );
}

/** A wait with no measure — the bench's catalogue being fetched. */
export function CloningScreen({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <GateCard
      wide
      icon={<FolderGit2 className="h-10 w-10 text-muted-foreground" />}
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
      {/* No measure to fill, so the bar only says that something is moving. */}
      <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
        <div className="h-full w-1/3 animate-pulse bg-primary" />
      </div>
    </GateCard>
  );
}

/** Repository fine, machine fine, project not in it: picking again is the only move, so no Retry. */
export function MissingScreen({
  strings,
  hint,
  detail,
  onBack,
}: {
  strings: ProjectGateStrings;
  /** What to do instead, when the gate knows better than the generic body. */
  hint?: string;
  /** The service's own sentence, folded away under `strings.details`. */
  detail?: string;
  onBack: () => void;
}) {
  return (
    <GateCard icon={<FolderSearch className="h-10 w-10 text-amber-500" />}>
      <h1 className="text-lg font-semibold">{strings.missingTitle}</h1>
      <p className="text-sm text-muted-foreground">
        {hint ?? strings.missingBody}
      </p>
      {detail && <Detail label={strings.details ?? "Details"} text={detail} />}
      <Back label={strings.back} onClick={onBack} />
    </GateCard>
  );
}

/** No library repository: not an error, and re-asking gives the same answer until it is set. */
export function NoLibrariesScreen({
  strings,
  addOne,
  onBack,
}: {
  strings: ProjectGateStrings;
  /** The way to ADD one, right here: a refusal that sends you elsewhere to fix it is a dead end. */
  addOne: ReactNode;
  onBack: () => void;
}) {
  return (
    <GateCard icon={<LibraryBig className="h-10 w-10 text-amber-500" />}>
      <h1 className="text-lg font-semibold">{strings.librariesTitle}</h1>
      <p className="text-sm text-muted-foreground">{strings.librariesBody}</p>
      {addOne && <div className="w-full text-left">{addOne}</div>}
      <Back label={strings.back} onClick={onBack} />
    </GateCard>
  );
}

/** Nothing in the workspace, and no wizard from the app: a sentence and the way back. */
export function EmptyWorkspaceScreen({
  strings,
  onBack,
}: {
  strings: ProjectGateStrings;
  onBack: () => void;
}) {
  return (
    <GateCard icon={<FolderSearch className="h-10 w-10 text-amber-500" />}>
      <p className="text-muted-foreground text-sm">
        {strings.emptyWorkspace ?? EMPTY_WORKSPACE}
      </p>
      <Back label={strings.back} onClick={onBack} />
    </GateCard>
  );
}

/** Resuming is the Retry road, and it takes a hand on a button — see docs/idle.md. */
export function IdleScreen({
  strings,
  onResume,
  onBack,
}: {
  strings: ProjectGateStrings;
  onResume: () => void;
  onBack: () => void;
}) {
  return (
    <GateCard icon={<Moon className="h-10 w-10 text-muted-foreground" />}>
      <h1 className="text-lg font-semibold">
        {strings.idleTitle ?? "Session suspended"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {strings.idleBody ??
          "Nothing happened here for a while, so the project was unloaded from the engine and this tab let go of it. Your files are untouched."}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={PRIMARY} onClick={onResume}>
          {strings.resume ?? "Resume"}
        </button>
        <button type="button" className={QUIET} onClick={onBack}>
          {strings.back}
        </button>
      </div>
    </GateCard>
  );
}

/** A fault, said by what the probe found: a refused origin and a dead service have opposite fixes. */
export function ErrorScreen({
  strings,
  fault,
  message,
  lines,
  fileBase,
  onRetry,
  onBack,
}: {
  strings: ProjectGateStrings;
  fault?: FileServiceFault;
  message: string;
  lines?: string[];
  fileBase: string | null | undefined;
  onRetry: () => void;
  onBack: () => void;
}) {
  const blocked = fault === "blocked";
  return (
    <GateCard
      icon={
        blocked ? (
          <ShieldAlert className="h-10 w-10 text-amber-500" />
        ) : (
          <ServerCrash className="h-10 w-10 text-amber-500" />
        )
      }
    >
      <h1 className="text-lg font-semibold">
        {blocked ? strings.blockedTitle : strings.unreachableTitle}
      </h1>
      <p className="text-sm text-muted-foreground">
        {blocked
          ? strings.blockedBody(window.location.origin)
          : fault === "unreachable"
            ? strings.unreachableBody(fileBase ?? "?")
            : // The probe didn't run (the service answered): the message says it.
              strings.bothBody}
      </p>
      <Detail
        label={strings.details ?? "Details"}
        text={lines?.length ? lines.join("\n") : message}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-secondary px-3 py-1.5 text-sm"
          onClick={onRetry}
        >
          {strings.retry}
        </button>
        <button type="button" className={QUIET} onClick={onBack}>
          {strings.back}
        </button>
      </div>
    </GateCard>
  );
}

/** Resolving: nothing to say yet. */
export function GateSpinner() {
  return (
    <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
