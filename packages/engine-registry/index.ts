// index.ts — the engine registry as a mountable pair: a store and the routes over it. Mounted
// by k7's backend, and consulted across the origin. See docs/shared.md.

export { type EngineMount, mountEngineRegistry } from "./mount.ts";
export { claimHolder, engineRole } from "./owners.ts";
export { replayBody } from "./proxy.ts";
export type { EngineRegistry } from "./registry.ts";
