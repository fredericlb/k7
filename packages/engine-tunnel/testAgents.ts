// testAgents.ts — the agents the tunnel suites run against: this package's own, and the native
// supervisor's (engine/st0-supervisor), whose `tunnel_harness` answers the same test jobs. Two
// implementations of one wire, held to one set of tests. The native one is skipped until built.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TunnelAgent, type TunnelAgentOptions } from "./agent.ts";

export interface AgentHandle {
  start(): void;
  stop(): void;
}

export interface AgentKind {
  name: string;
  make(opts: TunnelAgentOptions): AgentHandle;
}

/** The newest built harness under engine/st0-supervisor/build, or null. */
function harness(): string | null {
  const build = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "engine",
    "st0-supervisor",
    "build",
  );
  if (!existsSync(build)) return null;
  const found: string[] = [];
  for (const preset of readdirSync(build))
    for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"])
      for (const name of ["tunnel_harness", "tunnel_harness.exe"]) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p)) found.push(p);
      }
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

const node: AgentKind = {
  name: "node",
  make: (opts) => new TunnelAgent(opts),
};

/** The harness knows its jobs by heart, so `opts.jobs` is not passed — the suites use its names. */
function native(bin: string): AgentKind {
  return {
    name: "native",
    make: (opts) => {
      let child: ChildProcess | null = null;
      return {
        start() {
          child = spawn(
            bin,
            [
              opts.registryUrl,
              opts.id,
              opts.token,
              String(opts.enginePort),
              opts.cacheDir,
              ...(opts.renderKey ? [opts.renderKey] : []),
            ],
            { stdio: ["pipe", "ignore", "inherit"] },
          );
        },
        stop() {
          child?.stdin?.end();
          child?.kill();
          child = null;
        },
      };
    },
  };
}

const bin = harness();
export const agentKinds: AgentKind[] = bin ? [node, native(bin)] : [node];
