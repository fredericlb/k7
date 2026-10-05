// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set — ../../../../docs/versioning.md.
export const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
