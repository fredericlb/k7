import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The phone app's own page: the header and the engine tray. Not defineAppConfig — there is no
// backend to proxy and no service worker to want, since the WebView serves it from the APK's own
// assets (app/build.gradle.kts, stageShell). The studio apps themselves are NOT built here: they
// load from the connected studio, in native WebViews under this page's header (docs/android.md).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5230, strictPort: true },
});
