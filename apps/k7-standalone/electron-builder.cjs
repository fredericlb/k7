// electron-builder.cjs — packaging for the standalone app; scripts/stage.mjs must have run first.
// What every app on the shell shares — the staging copy, the unpacked guard — is @frediverse/electron-shell/builder's.

const { baseConfig } = require("@frediverse/electron-shell/builder");

// The bundle's version is the root package.json's; a snapshot adds its stamp as a prerelease (docs/menu.md).
const { version } = require("../../package.json");
const stamp = process.env.STUDIO_RELEASE_STAMP ?? "";
if (/^v\d/.test(stamp) && stamp !== `v${version}`)
  throw new Error(
    `release ${stamp} is not v${version}, the root package.json's version`,
  );
const bundleVersion = /^snapshot-[0-9a-f]+$/.test(stamp)
  ? `${version}-${stamp}`
  : version;

module.exports = {
  ...baseConfig({ appDir: __dirname }),
  extraMetadata: { version: bundleVersion },
  // Frozen once shipped: macOS keys microphone grants and single-instance on it.
  appId: "org.parapluie.k7.standalone",
  productName: "k7",
  icon: "../k7/frontend/public/icon-512.png",
  mac: {
    category: "public.app-category.music",
    target: ["dmg"],
    // Ad-hoc, every binary: unsigned, the renamed bundle's seal is broken and macOS calls it damaged (docs/standalone.md).
    identity: "-",
    // An ad-hoc signature has no team, so the hardened runtime's library validation would refuse ONNX Runtime.
    hardenedRuntime: false,
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
    // A .deb refuses to build without a maintainer, nor without package.json's homepage.
    maintainer: "F <fred@parapluie.org>",
  },
};
