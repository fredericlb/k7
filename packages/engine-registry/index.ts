// index.ts — the engine registry as a mountable pair: a store and the routes over it.
// Shared because l8 is no longer its only consumer — st0 must offer the same pick,
// and m9 will. See docs/shared.md.

export {
  ENGINE_BODY_LIMIT,
  type EngineMount,
  engineErrorHandler,
  mountEngineRegistry,
} from "./mount.ts";
export {
  attachEngineProxy,
  ENGINE_PROXY_PATH,
  issueEngineTicket,
  verifyEngineTicket,
} from "./proxy.ts";
export {
  createRegistry,
  type EngineEntry,
  type EngineRegistry,
  type HeartbeatInput,
  REGISTRY_TTL_MS,
} from "./registry.ts";
export { engineRegistryRouter } from "./router.ts";
