/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build stamp "YY.MMDDHHmm", set by the Dockerfile. Unset outside the image. */
  readonly VITE_APP_VERSION?: string;
}
