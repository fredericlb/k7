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

// The release's own file names (engine/scripts/package-release.mjs), so latest*.yml names what /app_downloads serves.
const fileStamp = (stamp || "dev").replace(/[^A-Za-z0-9._-]/g, "-");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const artifactName = (platform) =>
  `k7_${fileStamp}_${platform}-${arch}.\${ext}`;
// Where src/updates.ts downloads from, per channel; written beside the installers as latest*.yml (docs/app-downloads.md at the root).
const channel = /^v\d/.test(stamp) ? "release" : "snapshot";

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
    artifactName: artifactName("macos"),
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
  publish: {
    provider: "generic",
    url: `https://k7.rocks/app_downloads/${channel}`,
  },
  win: { target: ["nsis"], artifactName: artifactName("windows") },
  linux: {
    category: "Audio",
    target: ["AppImage", "deb"],
    artifactName: artifactName("linux"),
    // A .deb refuses to build without a maintainer, nor without package.json's homepage.
    maintainer: "F <fred@parapluie.org>",
  },
};
