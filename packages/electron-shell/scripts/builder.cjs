// builder.cjs — the electron-builder settings every app built on this shell shares; the app spreads its own over them.
// The staging folder is copied in by afterPack rather than extraResources, which silently drops every `node_modules` it meets.

const { cpSync } = require("node:fs");
const { join } = require("node:path");

/** Base config for the app at `appDir`, whose `staging/` (built before packaging) lands in Resources. */
function baseConfig({ appDir, staging = "staging" }) {
  return {
    directories: { output: "out", buildResources: "build" },
    files: ["dist/**/*", "package.json"],
    // A child node runs it from disk, and only Electron's own process reads inside an asar.
    asarUnpack: ["dist/guard.cjs"],
    // Nothing native loads in Electron's own process; the servers' deps are staged with their own install.
    npmRebuild: false,
    // The unpacked dist is used when set, for machines where the Electron download keeps failing.
    ...(process.env.ELECTRON_DIST
      ? { electronDist: process.env.ELECTRON_DIST }
      : {}),
    afterPack: async (context) => {
      const resources =
        context.electronPlatformName === "darwin"
          ? join(
              context.appOutDir,
              `${context.packager.appInfo.productFilename}.app`,
              "Contents",
              "Resources",
            )
          : join(context.appOutDir, "resources");
      cpSync(join(appDir, staging), resources, {
        recursive: true,
        verbatimSymlinks: true,
      });
    },
  };
}

module.exports = { baseConfig };
