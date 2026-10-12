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
  /** Present for a stream that needs tearing down: the WebRTC connection, or the chain's listener. */
  rtc?: { close: () => void };
  /** Recorded through a chain of st0's library, whose panel stays mounted for the take. */
  chain?: boolean;
}

export interface RehearsalRecordingApi {
  recording: RecordingCtx | null;
  /** The take runs collapsed to the bottom bar. */
  minimized: boolean;
  /** Opens the source chooser; throws when a take already runs, after bringing it back. */
  start: () => Promise<void>;
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
