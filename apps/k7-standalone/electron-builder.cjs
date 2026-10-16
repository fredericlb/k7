// electron-builder.cjs — packaging for the standalone app; scripts/stage.mjs must have run first.
// What every app on the shell shares — the staging copy, the unpacked guard — is @frediverse/electron-shell/builder's.

const { baseConfig } = require("@frediverse/electron-shell/builder");

// A tagged release is the bundle's version too, so the OS shows it; a snapshot keeps package.json's (docs/menu.md).
const tag = /^v(\d+\.\d+\.\d+)$/.exec(process.env.STUDIO_RELEASE_STAMP ?? "");

module.exports = {
  ...baseConfig({ appDir: __dirname }),
  ...(tag ? { extraMetadata: { version: tag[1] } } : {}),
  // Frozen once shipped: macOS keys microphone grants and single-instance on it.
  appId: "org.parapluie.k7.standalone",
  productName: "k7",
  icon: "../k7/frontend/public/icon-512.png",
  mac: {
    category: "public.app-category.music",
    target: ["dmg"],
    // Unsigned, like the tray: a partial signing gets the unsigned children SIGKILLed by Gatekeeper.
    identity: null,
    extendInfo: {
      NSMicrophoneUsageDescription: "k7 records and monitors audio inputs.",
      // A live-video project's webcam; without it macOS refuses the camera outright.
      NSCameraUsageDescription:
        "k7 shows and records your webcam in live-video projects.",
    },
  },
  win: { target: ["nsis"] },
  linux: {
    category: "Audio",
    target: ["AppImage", "deb"],
    // A .deb refuses to build without a maintainer.
    maintainer: "F <fred@parapluie.org>",
  },
};
