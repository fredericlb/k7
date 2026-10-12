// electron-builder.cjs — packaging for the standalone app; scripts/stage.mjs must have run first.
// What every app on the shell shares — the staging copy, the unpacked guard — is @studio/electron-shell/builder's.

const { baseConfig } = require("@studio/electron-shell/builder");

module.exports = {
  ...baseConfig({ appDir: __dirname }),
  // Frozen once shipped: macOS keys microphone grants and single-instance on it.
  appId: "org.parapluie.st0.standalone",
  productName: "st0",
  icon: "../st0/frontend/public/icon-512.png",
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
