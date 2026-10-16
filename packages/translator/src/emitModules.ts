// emitModules.ts — the imported PLUGINS: one module per plugin in the workspace's `_modules`, a node per
// use of it past the first, and a placeholder node for a plugin this machine cannot load.
// A module is keyed by the plugin, never by its settings — docs/import.md.

import { join } from "node:path";
import { scannedPlugins } from "@studio/song/engineCatalogue";
import {
  NOT_SUPPORTED_REF,
  NOT_SUPPORTED_TYPE,
} from "@studio/song-schema/moduleTypes";
import {
  type EmitCtx,
  type ModuleDef,
  paramsOf,
  slugify,
  uniquify,
  writeFile,
  yamlText,
} from "./emitNaming.js";
import type { PluginOut } from "./model.js";

// Plugin names in the local cache, for telling whether an imported plugin exists here; empty ⇒ skip the check.
function loadCachedPluginNames(file?: string): Set<string> {
  // Through scannedPlugins, so this reads the SAME file the engine writes and honours $STUDIO_HOME (docs/import.md).
  const names = new Set<string>();
  for (const p of file ? scannedPlugins(file) : scannedPlugins())
    if (p.name) names.add(p.name.toLowerCase());
  return names;
}

// Plugin chain order: instruments (and note FX) before audio FX; stable within.
const roleRank = (r?: string): number =>
  r === "instrument" ? 0 : r === "noteFX" ? 1 : 2;
export const orderPlugins = (ps: PluginOut[]): PluginOut[] =>
  ps
    .map((p, i) => [p, i] as const)
    .sort((a, b) => roleRank(a[0].role) - roleRank(b[0].role) || a[1] - b[1])
    .map((x) => x[0]);

// A plugin's type folder from its role, writing `transformers` rather than the legacy `midi`.
const typeFolderOf = (role?: string): string =>
  role === "instrument"
    ? "instruments"
    : role === "noteFX"
      ? "transformers"
      : "audio";

/** One insert of `p` on the chain `owner`, its module made on first use; answers the insert's node name. */
export function moduleRefFor(
  ctx: EmitCtx,
  p: PluginOut,
  owner: string,
): string {
  const folder = typeFolderOf(p.role);
  // Text params capture state when complete or when there is no preset; else keep the .vstpreset and skip partials.
  const hasParams = !!p.params && Object.keys(p.params).length > 0;
  const useParams = hasParams && (p.paramsComplete || !p.path);
  const params = useParams ? p.params : undefined;
  const preset = useParams ? undefined : p.path || undefined;
  const key = `${folder}/${p.type}/${p.name}`;
  let mod = ctx.moduleOf.get(key);
  if (!mod) {
    mod = {
      name: uniquify(slugify(p.name || p.type), ctx.usedModuleNames),
      folder,
      pluginType: p.type,
      pluginName: p.name,
      inserts: [],
    };
    ctx.moduleOf.set(key, mod);
    ctx.modules.push(mod);
  }
  // A sole use folds back into module.yaml, so the module's own name is taken as far as a node is concerned.
  ctx.usedNodeNames.add(mod.name.toLowerCase());
  // Each insert gets its OWN node even when identically set — they are separate slots; docs/import.md.
  const node = uniquify(`${mod.name}_${owner}`, ctx.usedNodeNames);
  mod.inserts.push({ node, params, preset });
  return node;
}

/** Drop the inserts no SURVIVING chain names, so an orphan never counts towards "used more than once". */
export function dropOrphanInserts(ctx: EmitCtx): void {
  const liveRefs = new Set<string>();
  for (const d of Object.values(ctx.chains))
    for (const step of d.use) liveRefs.add(step.module);
  for (const mod of ctx.modules)
    mod.inserts = mod.inserts.filter((i) => liveRefs.has(i.node));
}

/** A plugin used in exactly ONE place needs no node: fold it into module.yaml — see docs/import.md. */
export function collapseSoleInserts(ctx: EmitCtx): void {
  for (const mod of ctx.modules) {
    if (mod.inserts.length !== 1) continue;
    // …unless its bare name is a CHAIN's: a lane wins a bare name, so the step would name ITSELF (docs/import.md).
    if (ctx.chains[mod.name]) continue;
    const [only] = mod.inserts;
    const from = only.node;
    only.node = ""; // "" == the state lives in module.yaml
    for (const d of Object.values(ctx.chains))
      for (const step of d.use)
        if (step.module === from) step.module = mod.name;
  }
}

/** What writing the modules counted. */
export interface ModuleStats {
  moduleNodes: number;
  nodeFiles: number;
  modulePresetFiles: number;
  missingPlugins: string[];
}

/** A missing plugin gets NO module of its own: every use becomes a node on the built-in placeholder. */
function writeMissing(ctx: EmitCtx, b: ModuleDef): number {
  for (const ins of b.inserts) {
    const params = paramsOf(ins.params);
    writeFile(
      join(ctx.outDir, `nodes/${ins.node || b.name}.yaml`),
      yamlText(
        {
          extends: NOT_SUPPORTED_REF,
          // The plugin's real name, restated with the marker since a node's `plugin:` replaces its base's whole.
          plugin: { type: NOT_SUPPORTED_TYPE, name: b.pluginName },
          ...(params ? { params } : {}),
        },
        [],
        `MISSING PLUGIN: "${b.pluginName}" (${b.pluginType}) is not in the k7 plugin cache.\n` +
          `This node stands where it was: routing only, and bypassed. Install and scan it\n` +
          `('k7 engine scan') and re-import, or point this node's \`extends\` at a real module.\n` +
          `The params below are the ones the export carried, kept so nothing is lost.`,
      ),
    );
  }
  return b.inserts.length;
}

/** Modules -> module.yaml, plus one flat nodes/<node>.yaml per insert past the first — see docs/import.md. */
export function writeModules(ctx: EmitCtx, extsFile?: string): ModuleStats {
  // Which modules survive: one whose every insert is orphaned has nothing left to write.
  const liveModules = ctx.modules.filter((b) => b.inserts.length > 0);
  const cachedNames = loadCachedPluginNames(extsFile);
  const verify = cachedNames.size > 0; // nothing to check against without a scan
  const missingPlugins = new Set<string>();
  const stats = { moduleNodes: 0, nodeFiles: 0, modulePresetFiles: 0 };
  for (const b of liveModules) {
    // A module now lives at `@workspace`, beside the project rather than inside it.
    const dir = join(ctx.workspaceModulesDir, b.folder, b.name);
    const known = !verify || cachedNames.has(b.pluginName.toLowerCase());
    // A sole insert's state belongs in module.yaml (node === "").
    const sole = b.inserts.length === 1 && b.inserts[0].node === "";

    if (!known) {
      missingPlugins.add(b.pluginName);
      stats.nodeFiles += writeMissing(ctx, b);
      continue;
    }

    const value: Record<string, unknown> = {
      plugin: { type: b.pluginType, name: b.pluginName },
    };
    if (sole) {
      const params = paramsOf(b.inserts[0].params);
      if (params) value.params = params;
    }
    const note = sole
      ? undefined
      : `${b.pluginName} — used ${b.inserts.length} times in this song, so each use is a\n` +
        `NODE in nodes/ that extends this module. The plugin is declared once here;\n` +
        `each node carries only its own settings.`;
    writeFile(join(dir, "module.yaml"), yamlText(value, [], note));
    stats.moduleNodes++;

    for (const ins of b.inserts) {
      if (ins.node) {
        const params = paramsOf(ins.params);
        // A node is a flat file naming what it extends — packages/song/docs/nodes.md.
        writeFile(
          join(ctx.outDir, `nodes/${ins.node}.yaml`),
          yamlText(
            {
              extends: `@workspace/${b.folder}/${b.name}`,
              ...(params ? { params } : {}),
            },
            [],
            `${ins.node} — inherits ${b.name} (the plugin); only what this use sets differs.`,
          ),
        );
        stats.nodeFiles++;
      }
      if (ins.preset && ctx.assets[ins.preset]) {
        // Beside the file whose state it is: the node's in the project, or the module's folder for a sole use.
        const at = ins.node
          ? join(ctx.outDir, `nodes/${ins.node}.vstpreset`)
          : join(dir, `${b.name}.vstpreset`);
        writeFile(at, ctx.assets[ins.preset]);
        stats.modulePresetFiles++;
      }
    }
  }
  return { ...stats, missingPlugins: [...missingPlugins] };
}
