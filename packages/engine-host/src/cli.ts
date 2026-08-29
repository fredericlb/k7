#!/usr/bin/env node
// cli.ts — `studio-engine`: the supervisor for someone who wants only the engine, no desktop
// app. The SAME startSupervisor as main.ts, over a transport that prints a status line
// instead of NDJSON — one implementation of the contract, two front ends.
//
// It deliberately does NOT import ipcStdio: importing that reassigns process.stdout.write to
// stderr as a side effect, and here stdout is for the human. See docs/supervisorPolicy.md.

import { installProcessNet } from "./background.ts";
import type { HostEvent, HostSnapshot, HostTransport } from "./hostProtocol.ts";
import { startSupervisor } from "./supervisor.ts";

const isTty = process.stdout.isTTY === true;
const say = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

function statusLine(s: HostSnapshot): string {
  if (s.status === "error") return `error: ${s.error ?? "unknown"}`;
  if (s.status !== "running") return "stopped";
  const adopted = s.ownsEngine ? "" : " (adopted)";
  const plugins =
    s.pluginCount === null ? "scanning…" : `${s.pluginCount} plugins`;
  const registry = s.lastHeartbeatOk ? "registered" : "registry unreachable";
  const down = s.fileServiceFailed ? ", FILE SERVICE DOWN" : "";
  const sessions = s.sessions.length
    ? `, ${s.sessions.length} session${s.sessions.length === 1 ? "" : "s"}`
    : "";
  return `running${adopted} · id ${s.engineId.slice(0, 8)} · :${s.enginePort} · ${plugins} · ${registry}${sessions}${down}`;
}

/** Print only what CHANGED, so a log kept for a week is readable and a tty is not a waterfall. */
function makeTransport(): HostTransport {
  let last = "";
  return {
    emit(event: HostEvent): void {
      if (event.t === "notify") {
        say(`${event.title}: ${event.body}`);
        return;
      }
      // A `result` frame answers a command, and this front end sends none.
      if (event.t !== "state") return;
      const text = statusLine(event);
      if (text === last) return;
      last = text;
      say(text);
    },
    // Nothing drives this supervisor, so there are no commands and no channel to end. The
    // terminal is the window: the signal handlers in startSupervisor are the whole lifetime.
    listen(): void {},
  };
}

installProcessNet();

say("studio-engine — the audio engine and its file service. Ctrl-C to stop.");
if (!isTty)
  say("(not a terminal: SIGHUP will not arrive; send SIGTERM to stop cleanly)");

void startSupervisor({
  own: { engine: true, fileService: true, engineQueries: true },
  transport: makeTransport(),
}).catch((e: unknown) => {
  // The lock refusal lands here, and it is the message that matters most: a second supervisor
  // would adopt the first one's engine and stop it on the way out.
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
