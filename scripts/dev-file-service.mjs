#!/usr/bin/env node
// dev-file-service.mjs — the file service's dev server, run on the HOST when the sources live
// in WSL. It is the one dev server whose work is almost entirely `readdir` over the workspace
// root, which stays on NTFS: from the distro every one of those crosses the 9p bridge, and the
// listing walk goes from milliseconds to seconds. See docs/wsl.md.

import { spawn } from "node:child_process";

// Under WSL the workspaces are on the host: mirror the TS and run this same script THERE.
if (process.env.STUDIO_NATIVE_MIRROR && process.platform !== "win32") {
  const { runBridge } = await import("./dev-native-bridge.mjs");
  process.exit(
    await runBridge({
      name: "file-service",
      // `start`, not `dev`: tsx's own watcher starts the replacement before the old one lets go of
      // 8770, so the new process dies on EADDRINUSE and the OLD one serves stale code. The bridge
      // restarts instead, which it can do properly — ../docs/wsl.md.
      // Through run-tagged, which records the PID: the only handle on a task still starting.
      command:
        "node scripts\\run-tagged.mjs file-service packages\\file-service npm start",
      // The TS this service imports, unlike the tray's, is read at every restart rather than bundled once.
      watch: ["\\packages", "\\commons"],
      // Slower than the engine bridge: this pass reads 1300 files, and a save may wait a beat.
      periodMs: 1500,
      restartOnChange: true,
      stopCommand: "node scripts\\stop-host-port.mjs 8770 file-service",
      // What makes it "started": a restart during the boot is the EADDRINUSE — ../docs/wsl.md.
      readyPort: 8770,
    }),
  );
}

// macOS and Linux: the ordinary watcher, in this process, and nothing above applies.
// One string rather than an argv: node deprecates args beside `shell`, which .cmd needs on Windows.
const child = spawn("tsx watch src/server.ts", {
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
