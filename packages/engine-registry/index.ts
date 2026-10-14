// index.ts — the engine registry as a mountable pair: a store and the routes over it. Mounted
// by pl8 alone, and consulted by k7 and z0 across the origin. See docs/shared.md.

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
  replayBody,
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
