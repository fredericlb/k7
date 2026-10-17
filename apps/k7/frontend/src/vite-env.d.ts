/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build stamp "YY.MMDDHHmm", set by the Dockerfile. Unset outside the image. */
  readonly VITE_APP_VERSION?: string;
}

/** The third-party notices, built by notices/vitePlugin.ts — ../docs/about.md. */
declare module "virtual:k7-notices" {
  const notices: import("../notices/types").Notices;
  export default notices;
}
