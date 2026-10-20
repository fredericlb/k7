// engineArm.ts — arming a lane in the engine: wait for the session's link to open, send the arm,
// and pick its answer out of a broadcast channel. A link still DIALLING is not an engine that is
// offline: on the desktop it is re-dialled every time a tab comes to the front. See docs/activeProject.md.

/** How long the engine gets to answer an arm. A local socket answers in single-digit ms. */
export const ARM_TIMEOUT_MS = 2000;

/** How long an arm waits for a link still being dialled before saying so. */
export const LINK_OPEN_TIMEOUT_MS = 5000;

type ArmFrame = { track: string; armed: boolean };
/** The slice of EngineClient an arm needs — so the wait can be tested without a socket. */
export interface ArmingClient {
  on(event: "armed", fn: (a: ArmFrame) => void): unknown;
  on(event: "engineError", fn: (m: string) => void): unknown;
  on(event: "open", fn: () => void): unknown;
  off(event: "armed", fn: (a: ArmFrame) => void): unknown;
  off(event: "engineError", fn: (m: string) => void): unknown;
  off(event: "open", fn: () => void): unknown;
  arm(track: string, armed?: boolean): void;
}

/** Resolve true once `c` opens — at once when `isOpen` already says so — or false after `timeoutMs`. */
export function awaitLinkOpen(
  c: Pick<ArmingClient, "on" | "off">,
  isOpen: () => boolean,
  timeoutMs: number = LINK_OPEN_TIMEOUT_MS,
): Promise<boolean> {
  if (isOpen()) return Promise.resolve(true);
  return new Promise((res) => {
    const done = (v: boolean) => {
      clearTimeout(timer);
      c.off("open", onOpen);
      res(v);
    };
    const onOpen = () => done(true);
    const timer = setTimeout(() => done(isOpen()), timeoutMs);
    c.on("open", onOpen);
  });
}

/** Wait for the answer to ONE arm, matched on the TRACK; `undefined` = it did not take. See docs/activeProject.md. */
export function awaitArm(
  c: ArmingClient,
  track: string,
  out: string[],
  linkUp: () => boolean,
  timeoutMs: number = ARM_TIMEOUT_MS,
  armed?: boolean,
): Promise<boolean | undefined> {
  return new Promise((res) => {
    const done = (v?: boolean) => {
      clearTimeout(timer);
      c.off("armed", onArmed);
      c.off("engineError", onError);
      res(v);
    };
    const onArmed = (a: ArmFrame) => {
      if (a.track !== track) return; // another surface's arm, not the answer to this one
      done(a.armed);
    };
    const onError = (m: string) => {
      out.push(m);
      done(undefined);
    };
    // Both remaining states get named: a dropped link and a silent engine look alike otherwise.
    const timer = setTimeout(() => {
      out.push(
        linkUp()
          ? `engine did not answer the arm of "${track}" in ${timeoutMs}ms — the link is up, so check the engine log for a [rec] line`
          : `the engine link dropped while arming "${track}"`,
      );
      done(undefined);
    }, timeoutMs);
    c.on("armed", onArmed);
    c.on("engineError", onError);
    c.arm(track, armed);
  });
}

/** Arm `track` once the session's link is open, saying which wait ran out when one does. */
export async function armOnceOpen(
  c: ArmingClient,
  track: string,
  out: string[],
  isOpen: () => boolean,
  armed?: boolean,
  openTimeoutMs: number = LINK_OPEN_TIMEOUT_MS,
): Promise<boolean | undefined> {
  if (!(await awaitLinkOpen(c, isOpen, openTimeoutMs))) {
    out.push(
      `the engine link is still opening after ${openTimeoutMs / 1000} s — "${track}" was not armed; arm it again in a moment`,
    );
    return undefined;
  }
  return awaitArm(c, track, out, isOpen, ARM_TIMEOUT_MS, armed);
}
