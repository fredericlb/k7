// index.ts — the engine registry as a mountable pair: a store and the routes over it.
// Shared because lanes is no longer its only consumer — mediatek must offer the same pick,
// and platines will. See docs/shared.md.

export {
  createRegistry,
  type EngineEntry,
  type EngineRegistry,
  type HeartbeatInput,
  REGISTRY_TTL_MS,
} from "./registry.ts";
export { engineRegistryRouter } from "./router.ts";
