// binding.ts — pointing an account's file service at the engine the account CLAIMED, through
// that engine's tunnel. Only a claim binds: the registry lists every engine to everyone, and
// driving one is the claim's to grant, never a header's. See docs/fileHub.md.

import { dirname, join } from "node:path";
import type { EngineRegistry } from "@studio/engine-registry";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import { writeScanCopy } from "@studio/song/engineCatalogue";
import {
  AUTO_RENDERS_HOME_DIR,
  HISTORY_HOME_DIR,
  LIBRARIES_HOME_DIR,
} from "@studio/song-schema/moduleTypes";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import type { Instance } from "./instances.ts";

export interface BindingDeps {
  registry: Pick<EngineRegistry, "get">;
  tunnels: Pick<
    TunnelHub,
    | "bindLocal"
    | "unbindLocal"
    | "openReady"
    | "bindRenderer"
    | "rendersEnabled"
  >;
  /** This server's own port, which the instance dials on loopback. */
  selfPort: () => number;
  mediatekRoot?: string;
  log: (msg: string) => void;
}

/** How long the engine gets to list its plugins; a cold scan is slow, and nothing waits on this. */
const PLUGINS_TIMEOUT_MS = 30_000;
/** How long a scan running at the bind is listened to for the list it ends on: a cold one loads every plugin. */
const SCAN_LISTEN_MS = 15 * 60_000;

/** The libraries, read-only: the hub's ONE folder of each, every account's alike. */
const librariesRoots = (inst: Pick<Instance, "home">): TunnelRoot[] => [
  {
    remote: join(dirname(inst.home), LIBRARIES_HOME_DIR),
    name: "libs",
    writable: false,
    perChild: true,
  },
];

/** What an engine's machine may see of an account: its workspaces, its render and undo caches, its libraries, its models and the médiathèque read-only — never its keys. */
export function rootsFor(
  inst: Pick<Instance, "home" | "slug">,
  mediatekRoot?: string,
): TunnelRoot[] {
  const roots: TunnelRoot[] = [
    {
      remote: join(inst.home, "workspace"),
      name: `ws-${inst.slug}`,
      writable: true,
    },
    ...librariesRoots(inst),
    // The models a separation or an amp names, downloaded once here and copied once there.
    {
      remote: join(inst.home, "models"),
      name: `models-${inst.slug}`,
      writable: false,
    },
    // Writable: an automatic VST render is made there and uploaded back (packages/song/docs/autoFreeze.md).
    {
      remote: join(inst.home, AUTO_RENDERS_HOME_DIR),
      name: `renders-${inst.slug}`,
      writable: true,
    },
    // Writable: the machine KEEPS the undo journal's audio, and sends a file back up for an undo (packages/file-service/docs/history.md).
    {
      remote: join(inst.home, HISTORY_HOME_DIR),
      name: `history-${inst.slug}`,
      writable: true,
    },
  ];
  if (mediatekRoot)
    roots.push({ remote: mediatekRoot, name: "mediatek", writable: false });
  return roots;
}

/** What a médiathèque CUT shares with the engine's machine: the song's library writable, for the stems, and the model's homes read-only. */
export function cutRoots(inst: Instance, mediatekRoot: string): TunnelRoot[] {
  return [
    { remote: mediatekRoot, name: "mediatek", writable: true },
    {
      remote: join(inst.home, "models"),
      name: `models-${inst.slug}`,
      writable: false,
    },
    {
      remote: join(inst.home, "workspace"),
      name: `ws-${inst.slug}`,
      writable: false,
    },
    ...librariesRoots(inst),
  ];
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
  engine: { id: string; name: string } | null = null,
): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${inst.port}/hub/engine`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HUB_SECRET_HEADER]: inst.secret,
    },
    body: JSON.stringify({
      url,
      jobsUrl,
      engineId: engine?.id ?? null,
      engineName: engine?.name ?? null,
    }),
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
    // Anyone may register an engine, so only one this account has CLAIMED ever sees its files.
    if (inst.engineId === id || !holdsClaim(deps.registry, id, inst.user))
      return;
    const roots = rootsFor(inst, deps.mediatekRoot);
    // Synced: the file service copies a document's files before sending it, so the engine's channel never fetches.
    const path = deps.tunnels.bindLocal(id, roots, "engine", { synced: true });
    // Beside it, the machine's own jobs: every separation this account asks for runs there.
    const jobsPath = deps.tunnels.bindLocal(id, roots, "jobs");
    const at = `ws://127.0.0.1:${deps.selfPort()}`;
    try {
      // Its identity too: an undo's audio is kept by ONE engine, and an error names it.
      const name = deps.registry.get(id)?.hostname || id;
      await tell(inst, `${at}${path}`, `${at}${jobsPath}`, { id, name });
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

/** The engine's plugin list, written where the file service reads the scan — `<home>/exts.json` — and again when a scan running at the bind ends. */
async function refreshPlugins(
  deps: BindingDeps,
  inst: Instance,
  id: string,
): Promise<void> {
  const ch = await deps.tunnels.openReady(id, [], PLUGINS_TIMEOUT_MS);
  if (!ch) return;
  const at = join(inst.home, "exts.json");
  let heard = false;
  await new Promise<void>((resolve) => {
    let timer = setTimeout(resolve, PLUGINS_TIMEOUT_MS);
    ch.on("message", (d: Buffer) => {
      try {
        const m = JSON.parse(d.toString("utf8"));
        if (m.type !== "plugins") return;
        heard = true;
        // Left alone when it says the same: a rewrite at every bind threw away the compile an open had just made (packages/file-service/docs/workspace.md).
        writeScanCopy(Array.isArray(m.plugins) ? m.plugins : [], at);
        clearTimeout(timer);
        // A scan still running replaces this list when it ends, and broadcasts the new one (engine/k7-runtime/docs/plugins.md).
        if (m.scanning === true) timer = setTimeout(resolve, SCAN_LISTEN_MS);
        else resolve();
      } catch {
        /* not JSON, or a copy that would not write — not the answer */
      }
    });
    ch.send(JSON.stringify({ type: "list-plugins" }));
  });
  ch.close();
  if (!heard) deps.log(`[${inst.slug}] engine ${id} never listed its plugins`);
}
