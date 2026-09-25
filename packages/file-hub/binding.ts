// binding.ts — pointing an account's file service at the engine the account CLAIMED, through
// that engine's tunnel. Only a claim binds: the registry lists every engine to everyone, and
// driving one is the claim's to grant, never a header's. See docs/fileHub.md.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EngineRegistry } from "@studio/engine-registry";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import type { Instance } from "./instances.ts";

export interface BindingDeps {
  registry: Pick<EngineRegistry, "get">;
  tunnels: Pick<TunnelHub, "bindLocal" | "unbindLocal" | "openReady">;
  /** This server's own port, which the instance dials on loopback. */
  selfPort: () => number;
  mediatekRoot?: string;
  log: (msg: string) => void;
}

/** How long the engine gets to list its plugins; a cold scan is slow, and nothing waits on this. */
const PLUGINS_TIMEOUT_MS = 30_000;

/** What an engine's machine may see of an account: its workspaces, its models and the médiathèque read-only — never its keys. */
export function rootsFor(inst: Instance, mediatekRoot?: string): TunnelRoot[] {
  const roots: TunnelRoot[] = [
    {
      remote: join(inst.home, "workspace"),
      name: `ws-${inst.slug}`,
      writable: true,
    },
    // The models a separation or an amp names, downloaded once here and copied once there.
    {
      remote: join(inst.home, "models"),
      name: `models-${inst.slug}`,
      writable: false,
    },
  ];
  if (mediatekRoot)
    roots.push({ remote: mediatekRoot, name: "mediatek", writable: false });
  return roots;
}

/** Drop both loopback paths an instance holds, the engine's and its machine's jobs. */
export function unbindAll(
  deps: Pick<BindingDeps, "tunnels">,
  inst: Instance,
): void {
  if (inst.localPath) deps.tunnels.unbindLocal(inst.localPath);
  if (inst.jobsPath) deps.tunnels.unbindLocal(inst.jobsPath);
  inst.localPath = null;
  inst.jobsPath = null;
}

/** Whether `user` holds a live claim on engine `id`. */
export function holdsClaim(
  registry: BindingDeps["registry"],
  id: string,
  user: string,
): boolean {
  const e = registry.get(id);
  if (!e) return false;
  for (const h of e.holders.values()) if (h.holder === user) return true;
  return false;
}

async function tell(
  inst: Instance,
  url: string | null,
  jobsUrl: string | null = null,
): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${inst.port}/hub/engine`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HUB_SECRET_HEADER]: inst.secret,
    },
    body: JSON.stringify({ url, jobsUrl }),
  });
  if (!r.ok)
    throw new Error(`the file service refused the binding (${r.status})`);
}

/** Bind `inst` to engine `id` if its account holds the claim; a no-op when already bound to it. */
export function bindEngine(
  deps: BindingDeps,
  inst: Instance,
  id: string,
): Promise<void> {
  const run = inst.binding.then(async () => {
    if (inst.engineId === id || !holdsClaim(deps.registry, id, inst.user))
      return;
    const roots = rootsFor(inst, deps.mediatekRoot);
    const path = deps.tunnels.bindLocal(id, roots);
    // Beside it, the machine's own jobs: every separation this account asks for runs there.
    const jobsPath = deps.tunnels.bindLocal(id, roots, "jobs");
    const at = `ws://127.0.0.1:${deps.selfPort()}`;
    try {
      await tell(inst, `${at}${path}`, `${at}${jobsPath}`);
    } catch (e) {
      deps.tunnels.unbindLocal(path);
      deps.tunnels.unbindLocal(jobsPath);
      throw e;
    }
    unbindAll(deps, inst);
    inst.engineId = id;
    inst.localPath = path;
    inst.jobsPath = jobsPath;
    deps.log(`[${inst.slug}] drives engine ${id}`);
    void refreshPlugins(deps, inst, id);
  });
  // A failed binding must not poison the ones queued after it.
  inst.binding = run.catch(() => {});
  return run;
}

/** Let go of the bound engine once the account no longer holds its claim — an engine serves one account at a time, and the next one took it. */
export function releaseIfUnclaimed(
  deps: BindingDeps,
  inst: Instance,
): Promise<void> {
  const run = inst.binding.then(async () => {
    const id = inst.engineId;
    if (!id || holdsClaim(deps.registry, id, inst.user)) return;
    await tell(inst, null);
    unbindAll(deps, inst);
    inst.engineId = null;
    deps.log(`[${inst.slug}] let go of engine ${id}: its claim moved on`);
  });
  inst.binding = run.catch(() => {});
  return run;
}

/** The engine's plugin list, written where the file service reads the scan — `<home>/exts.json`. */
async function refreshPlugins(
  deps: BindingDeps,
  inst: Instance,
  id: string,
): Promise<void> {
  const ch = await deps.tunnels.openReady(id, [], PLUGINS_TIMEOUT_MS);
  if (!ch) return;
  const plugins = await new Promise<unknown[] | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), PLUGINS_TIMEOUT_MS);
    ch.on("message", (d: Buffer) => {
      try {
        const m = JSON.parse(d.toString("utf8"));
        if (m.type !== "plugins") return;
        clearTimeout(timer);
        resolve(Array.isArray(m.plugins) ? m.plugins : []);
      } catch {
        /* not JSON — not the answer */
      }
    });
    ch.send(JSON.stringify({ type: "list-plugins" }));
  });
  ch.close();
  if (!plugins) {
    deps.log(`[${inst.slug}] engine ${id} never listed its plugins`);
    return;
  }
  // The scan file's own shape, so every reader of it works unchanged.
  await writeFile(
    join(inst.home, "exts.json"),
    JSON.stringify({ entries: [{ plugins }] }),
  );
}
