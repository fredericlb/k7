// electron-builder.cjs — packaging for the standalone app; scripts/stage.mjs must have run first.
// staging/ is copied in by afterPack rather than extraResources, which silently drops every `node_modules` it meets.

const { cpSync } = require("node:fs");
const { join } = require("node:path");

module.exports = {
  // Frozen once shipped: macOS keys microphone grants and single-instance on it.
  appId: "org.parapluie.st0.standalone",
  productName: "st0",
  icon: "../st0/frontend/public/icon-512.png",
  directories: { output: "out", buildResources: "build" },
  files: ["dist/**/*", "package.json"],
  // A child node runs it from disk, and only Electron's own process reads inside an asar.
  asarUnpack: ["dist/guard.cjs"],
  // Nothing native loads in Electron's own process; the backends' deps are staged with their own install.
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
    cpSync(join(__dirname, "staging"), resources, {
      recursive: true,
      verbatimSymlinks: true,
    });
  },
  mac: {
    category: "public.app-category.music",
    target: ["dmg"],
    // Unsigned, like the tray: a partial signing gets the unsigned children SIGKILLed by Gatekeeper.
    identity: null,
    extendInfo: {
      NSMicrophoneUsageDescription: "st0 records and monitors audio inputs.",
    },
  },
  win: { target: ["nsis"] },
  linux: { category: "Audio", target: ["AppImage"] },
};
