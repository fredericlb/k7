// nodeOnRef.ts — a node made straight over a module REF (`@k7-core/instruments/k7-rack`), with no
// `@workspace` module scaffolded in between. `createNode` takes `<category>/<name>` and so only reaches
// the workspace's own modules and the engine's; a library module reached that way would get a local
// shim extending it, a second file standing for the same thing (packages/song/docs/nodes.md).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createChainNode } from "./chainCreate";
import { isChainProject } from "./chainProject";
import { loadModuleRefs, NODES_DIR } from "./loader";
import type { LoadedModule } from "./rawDoc";
import { wsExists, wsWrite } from "./yaml/workspaceFile";

/** Write `nodes/<node>.yaml` extending `ref`, which must resolve; the file written — in a chain project, the new node's id. */
export function createNodeOn(
  dir: string,
  ref: string,
  node: string,
  refs: Record<string, LoadedModule> = loadModuleRefs(dir),
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(node))
    throw new Error(
      `invalid node name '${node}' — letters, digits, '_' and '-' only`,
    );
  const m = refs[ref];
  if (!m || m.node || m.engineOf)
    throw new Error(`'${ref}' is not a module this project can see`);
  if (m.kind === "io")
    throw new Error(`'${ref}' is an io module — use node new io/<role>`);
  const body =
    `# ${node}: one use of module "${ref}" — state only what THIS use changes.\n` +
    `extends: ${JSON.stringify(ref)}\n`;
  if (isChainProject(dir)) return createChainNode(dir, node, body).id;
  const rel = `${NODES_DIR}/${node}.yaml`;
  if (wsExists(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  wsWrite(join(dir, rel), body);
  return rel;
}
