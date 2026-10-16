/// <reference types="vite/client" />
/// Declares the `virtual:pwa-register` module main.tsx registers the service worker through.
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Build stamp "YY.MMDDHHmm", set by the Dockerfile. Unset outside the image. */
  readonly VITE_APP_VERSION?: string;
}
