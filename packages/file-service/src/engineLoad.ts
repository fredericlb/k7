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

/** The phase of each session whose project is still being made ready, and the engine link warming it. */
const loads = new Map<string, { phase: EngineLoadPhase; engine?: unknown }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A project was opened in `session`: the gate waits until the load ends. */
export function beginLoad(session: string): void {
  loads.set(session, { phase: "copying" });
}

export function loadPhase(session: string): EngineLoadPhase | null {
  return loads.get(session)?.phase ?? null;
}

/** Stop waiting — a failed copy, no engine at all: the project screen says what is wrong. */
export function endLoad(session: string): void {
  loads.delete(session);
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
  const mine = { phase: "applying" as EngineLoadPhase, engine: deps.engine };
  loads.set(session, mine);
  let played = false;
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
      await sleep(POLL_MS);
    }
    if (loads.get(session) !== mine) return;
    mine.phase = "warming";
    deps.sendProject({ ...doc, masterVolume: SILENT_DB });
    deps.play();
    played = true;
    await sleep(DRY_RUN_MS);
    deps.stopAndRewind();
    await sleep(TAIL_MS);
  } catch (e) {
    deps.log(`dry run: ${(e as Error).message}`);
  } finally {
    const ours = loads.get(session) === mine;
    if (ours) loads.delete(session);
    // The restore is what un-silences the master, so it runs whenever the silenced copy went out.
    if (played || ours) deps.restore();
  }
}
