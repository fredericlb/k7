// context.ts — the running take as the pages see it: start one, resume one, and the counter that
// tells a list a session was created, saved or dropped behind its back.

import { createContext, useContext } from "react";
import type { Envelope, Session } from "../types";

/** The in-progress recording, independent of the route so the pages stay browsable while it runs. */
export interface RecordingCtx {
  session: Session;
  stream: MediaStream;
  /** Seconds already recorded; its presence means "append to the existing take". */
  resumeFrom?: number;
  /** The saved recording's envelope, shown as history behind the new take. */
  baseEnvelope?: Envelope;
  /** Present for a stream that needs tearing down: the chain's listener and its hidden bench. */
  release?: { close: () => void };
  /** Recorded through the rehearsal chain, whose hidden bench stays mounted for the take. */
  chain?: boolean;
}

/** Where a session's audio comes from: this device's microphone, or the account's rehearsal chain on k7's bench. */
export type SessionSource = "local" | "chain";

export interface RehearsalRecordingApi {
  recording: RecordingCtx | null;
  /** A take runs, so the recorder's bar covers the foot of every page. */
  barShown: boolean;
  /** Starts a session from `source`; throws when a take already runs, after bringing it back. */
  start: (source: SessionSource) => Promise<void>;
  /** Appends to a saved take; throws, with a sentence to show, when it cannot. */
  resume: (session: Session) => Promise<void>;
  /** Bumped whenever this provider created, saved or dropped a session. */
  changed: number;
}

export const RecordingContext = createContext<RehearsalRecordingApi | null>(
  null,
);

export function useRehearsalRecording(): RehearsalRecordingApi {
  const r = useContext(RecordingContext);
  if (!r) throw new Error("useRehearsalRecording outside RehearsalRecording");
  return r;
}
