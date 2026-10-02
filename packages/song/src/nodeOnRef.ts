// nodeOnRef.ts — a node made straight over a module REF (`@st0/instruments/st0-rack`), with no
// `@workspace` module scaffolded in between. `createNode` takes `<category>/<name>` and so only reaches
// the workspace's own modules and the engine's; a library module reached that way would get a local
// shim extending it, a second file standing for the same thing (packages/song/docs/nodes.md).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadModuleRefs, NODES_DIR } from "./loader";
import type { LoadedModule } from "./rawDoc";

/** Write `nodes/<node>.yaml` extending `ref`, which must resolve; the file written, project-relative. */
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
  const rel = `${NODES_DIR}/${node}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  writeFileSync(
    join(dir, rel),
    `# ${node}: one use of module "${ref}" — state only what THIS use changes.\n` +
      `extends: ${JSON.stringify(ref)}\n`,
    "utf8",
  );
  return rel;
}
