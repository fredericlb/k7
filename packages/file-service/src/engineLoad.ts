// engineLoad.ts — what a project goes through between being opened and being playable: its files
// copied to the engine's machine, the document applied, then a DRY RUN — half a second played with
// the master at silence, then stopped — so the first real play finds every plugin already running.
// The project gate waits for it. See docs/engineLoad.md.

import type { ProjectDoc } from "@studio/song/project";
import type { EngineLoadPhase } from "@studio/web-protocol";

/** How long the engine gets to apply the project, plugins included, before the gate lets go anyway. */
const APPLY_TIMEOUT_MS = 120_000;
/** How often the engine is asked whether it holds the project yet. */
const POLL_MS = 300;
/** How long the dry run plays. */
const DRY_RUN_MS = 500;
/** Kept silent after the stop, so a reverb's or a delay's tail is not heard when the master comes back. */
const TAIL_MS = 1500;
/** -100 dB is exactly zero on the engine's master gain. */
const SILENT_DB = -100;

/** One session's load: its phase, the engine link warming it, and how to cut its dry run short. */
interface Load {
  phase: EngineLoadPhase;
  engine?: unknown;
  /** Stops a dry run that has played, AT ONCE, and wakes its waits — docs/engineLoad.md. */
  cancel?: () => void;
}

/** The phase of each session whose project is still being made ready, and the engine link warming it. */
const loads = new Map<string, Load>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replace `session`'s load, cutting the one it replaces short first: its stop must reach the engine before anything else does. */
function replaceLoad(session: string, next: Load | null): void {
  const prev = loads.get(session);
  if (next) loads.set(session, next);
  else loads.delete(session);
  prev?.cancel?.();
}

/** A project was opened in `session`: the gate waits until the load ends. */
export function beginLoad(session: string): void {
  replaceLoad(session, { phase: "copying" });
}

export function loadPhase(session: string): EngineLoadPhase | null {
  return loads.get(session)?.phase ?? null;
}

/** Stop waiting — a failed copy, no engine at all: the project screen says what is wrong. */
export function endLoad(session: string): void {
  replaceLoad(session, null);
}

/** Whether documents must be held back: the engine is playing a silenced copy, which the restore replaces. */
export function isWarming(session: string): boolean {
  return loads.get(session)?.phase === "warming";
}

/** What the dry run needs of the session's engine link. */
export interface WarmDeps {
  sendProject(doc: ProjectDoc): void;
  play(): void;
  stopAndRewind(): void;
  /** The link this dry run drives: a document reaching the session through ANOTHER one takes the load over. */
  engine: unknown;
  /** Whether that link is still the session's — false once the account's engine changed under it. */
  current(): boolean;
  /** Whether any engine is selected: with none, nothing will ever answer and the gate lets go. */
  hasEngine(): boolean;
  /** Whether the engine holds a built project for the session; undefined when it did not answer. */
  loaded(): Promise<boolean | undefined>;
  /** Send the session's latest document, the master at its own level. */
  restore(): void;
  log(msg: string): void;
}

/** The document just reached the engine: wait for it to be applied, then run the dry run once. */
export async function warmUp(
  session: string,
  doc: ProjectDoc,
  deps: WarmDeps,
): Promise<void> {
  const load = loads.get(session);
  // A fresh load, or one still waiting on an engine the session has since left (docs/engineLoad.md).
  const takeOver = load?.phase === "applying" && load.engine !== deps.engine;
  if (load?.phase !== "copying" && !takeOver) return;
  let played = false;
  let stopped = false;
  // The dry run's one stop, whoever asks first: its own timer, or the load that replaced it.
  const stop = (): void => {
    if (!played || stopped) return;
    stopped = true;
    deps.stopAndRewind();
  };
  let wake = (): void => {};
  const woken = new Promise<void>((r) => {
    wake = r;
  });
  const wait = (ms: number) => Promise.race([sleep(ms), woken]);
  const mine: Load = {
    phase: "applying",
    engine: deps.engine,
    cancel: () => {
      stop();
      wake();
    },
  };
  loads.set(session, mine);
  try {
    const deadline = Date.now() + APPLY_TIMEOUT_MS;
    while (!(await deps.loaded())) {
      // Another project opened, another engine took the load over, or it was ended: nobody's any more.
      if (loads.get(session) !== mine) return;
      // The engine changed under it: wait for the new one's document, or let the gate go if there is none.
      if (!deps.current()) {
        if (deps.hasEngine()) loads.set(session, { phase: "copying" });
        else loads.delete(session);
        return;
      }
      if (Date.now() > deadline) {
        deps.log("the engine did not report the project loaded in time");
        return;
      }
      await wait(POLL_MS);
    }
    if (loads.get(session) !== mine) return;
    mine.phase = "warming";
    deps.sendProject({ ...doc, masterVolume: SILENT_DB });
    deps.play();
    played = true;
    await wait(DRY_RUN_MS);
    stop();
    // Replaced: the next load's document is on its way, and a tail waited out here would land in the middle of it.
    if (loads.get(session) !== mine) return;
    await wait(TAIL_MS);
  } catch (e) {
    deps.log(`dry run: ${(e as Error).message}`);
  } finally {
    stop();
    const ours = loads.get(session) === mine;
    if (ours) loads.delete(session);
    // Un-silences the master — unless a newer load holds the session, whose own document does that (docs/engineLoad.md).
    if (ours || (played && !loads.has(session))) deps.restore();
  }
}
