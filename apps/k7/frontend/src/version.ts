// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set — ../../../../docs/versioning.md.
import { version } from "../package.json";

export const STAMP = import.meta.env.VITE_APP_VERSION ?? "dev";
// The release version, this package.json's copy of the root's, then the image's stamp.
export const VERSION = `${version} (${STAMP})`;
