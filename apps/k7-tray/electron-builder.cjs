// electron-builder.cjs — packaging for the tray; scripts/stage.mjs must have run first.
// The appId is FROZEN: macOS keys the microphone grant and the login item on it (docs/tray.md).

const { join } = require("node:path");
const { baseConfig } = require("@frediverse/electron-shell/builder");

const icons = join(__dirname, "icons");

// The bundle's version is the root package.json's; a snapshot adds its stamp as a prerelease, as the desktop app does.
const { version } = require("../../package.json");
const stamp = process.env.STUDIO_RELEASE_STAMP ?? "";
if (/^v\d/.test(stamp) && stamp !== `v${version}`)
  throw new Error(
    `release ${stamp} is not v${version}, the root package.json's version`,
  );
const bundleVersion = /^snapshot-[0-9a-f]+$/.test(stamp)
  ? `${version}-${stamp}`
  : version;

// The release's own file names (engine/scripts/package-release.mjs), so latest*.yml names what /app_downloads/tray serves.
const fileStamp = (stamp || "dev").replace(/[^A-Za-z0-9._-]/g, "-");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const artifactName = (platform) =>
  `k7-tray_${fileStamp}_${platform}-${arch}.\${ext}`;
// Where src/updates.ts downloads from, per channel; written beside the installers as latest*.yml (docs/app-downloads.md at the root).
const channel = /^v\d/.test(stamp) ? "release" : "snapshot";

module.exports = {
  ...baseConfig({ appDir: __dirname }),
  extraMetadata: { version: bundleVersion },
  appId: "org.parapluie.studio.engine-tray",
  productName: "k7-tray",
  mac: {
    category: "public.app-category.music",
    target: ["dmg"],
    icon: join(icons, "icon.icns"),
    artifactName: artifactName("macos"),
    // Ad-hoc, every binary, as the desktop app: unsigned, the bundle's seal is broken and macOS calls it damaged.
    identity: "-",
    // An ad-hoc signature has no team, so the hardened runtime's library validation would refuse ONNX Runtime.
    hardenedRuntime: false,
    extendInfo: {
      // A menu-bar agent from the first frame, before the main process hides the Dock icon.
      LSUIElement: true,
      // Without it macOS never asks, and the engine this app launches records silence (docs/tray.md).
      NSMicrophoneUsageDescription:
        "k7 records the audio inputs of this machine onto the tracks you arm.",
    },
  },
  publish: {
    provider: "generic",
    url: `https://k7.rocks/app_downloads/tray/${channel}`,
  },
  win: {
    target: ["nsis"],
    icon: join(icons, "icon.ico"),
    artifactName: artifactName("windows"),
  },
  linux: {
    category: "Audio",
    target: ["AppImage", "deb"],
    icon: join(icons, "icon.png"),
    artifactName: artifactName("linux"),
    // A .deb refuses to build without a maintainer, nor without package.json's homepage.
    maintainer: "F <fred@parapluie.org>",
  },
};
