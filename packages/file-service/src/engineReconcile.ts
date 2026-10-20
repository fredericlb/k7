// engineReconcile.ts — the poll's check that the engine still holds what a session was sent, and
// the re-send or re-dial when it does not: a silent socket is re-dialled, a deaf one too after
// RESEND_LIMIT re-sends. See docs/activeProject.md.

import { basename } from "node:path";
import type { SessionInfo } from "@studio/engine-client/engineControl";
import { isWarming, loadPhase } from "./engineLoad.ts";
import {
  dropLink,
  ensureEngine,
  isReady,
  type Served,
  sessionOf,
} from "./engineSessions.ts";
import { isHeldBack } from "./engineSync.ts";
import type { Workspace } from "./workspace.ts";

/** How often the /workspace poll may re-ask the engine what it holds. Polled every 2 s, per tab. */
export const RECONCILE_EVERY_MS = 5_000;
/** Re-sends the engine may ignore before the socket is presumed deaf — docs/activeProject.md. */
export const RESEND_LIMIT = 3;
/** How long the engine gets to answer that question before its link is treated as dead. */
export const SESSIONS_TIMEOUT_MS = 2000;

/** The slice of EngineClient a reconcile needs — so the wait can be tested without a socket. */
export interface SessionListingClient {
  on(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  off(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  listSessions(): void;
}

/** Ask the engine what it is holding; `undefined` = no answer at all. See docs/activeProject.md. */
export function awaitSessions(
  c: SessionListingClient,
  timeoutMs: number = SESSIONS_TIMEOUT_MS,
): Promise<SessionInfo[] | undefined> {
  return new Promise((res) => {
    const done = (v?: SessionInfo[]): void => {
      clearTimeout(timer);
      c.off("sessions", onSessions);
      res(v);
    };
    const onSessions = (list: SessionInfo[]): void => done(list);
    const timer = setTimeout(() => done(undefined), timeoutMs);
    c.on("sessions", onSessions);
    c.listSessions();
  });
}

/** Ask whether the engine still holds what `served` claims, and put it back if not — docs/activeProject.md. */
export async function reconcileEngine(
  ws: Workspace,
  s: Served,
  now: number,
  resend: (ws: Workspace, project: string) => void,
): Promise<void> {
  // Throttled PER SESSION, so one person's poll cannot eat another's turn.
  if (s.reconciling || now - s.lastReconcile < RECONCILE_EVERY_MS) return;
  // A document held back by a copy, running or failed, is not on the engine, and that is no fault of the engine's.
  if (isHeldBack(sessionOf(ws))) return;
  // …and one held for the engine's plugin scan has not been sent at all (engineScanGate.ts).
  if (loadPhase(sessionOf(ws)) === "scanning") return;
  const serving = s.project;
  s.lastReconcile = now;
  s.reconciling = true;
  try {
    const session = sessionOf(ws);
    const c = ensureEngine(ws);
    // A link still dialling re-sends from its own `open`; asking now would time out on the wait, not the engine.
    if (!c || !isReady(ws)) return;
    // A load in flight asks the engine itself and owns the verdict: a project still building is busy, not deaf.
    if (loadPhase(session) === "applying" || isWarming(session)) return;
    const held = await awaitSessions(c);
    if (held === undefined) {
      console.error(`   ✗ engine link unresponsive — re-dialling ${session}`);
      dropLink(session);
      ensureEngine(ws); // a fresh socket, whose `open` re-sends what this session was serving
      return;
    }
    if (held.some((x) => x.id === session && x.loaded)) {
      s.resends = 0;
      return;
    }
    // A socket that answers but never takes the project is deaf, not busy — docs/activeProject.md.
    if (++s.resends > RESEND_LIMIT) {
      console.error(
        `   ✗ engine took ${RESEND_LIMIT} re-sends without holding ${basename(serving)} — re-dialling ${session}`,
      );
      s.resends = 0;
      dropLink(session);
      ensureEngine(ws); // a fresh socket, whose `open` re-sends what this session was serving
      return;
    }
    console.warn(
      `   ⚠ engine is not holding ${basename(serving)} — re-sending it (${s.resends}/${RESEND_LIMIT})`,
    );
    resend(ws, serving);
  } finally {
    s.reconciling = false;
  }
}
