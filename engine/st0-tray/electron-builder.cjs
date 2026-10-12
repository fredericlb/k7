// electron-builder.cjs — packaging for the tray; scripts/stage.mjs must have run first.
// The appId is FROZEN: macOS keys the microphone grant and the login item on it (docs/tray.md).

const { join } = require("node:path");
const { baseConfig } = require("@frediverse/electron-shell/builder");

const icons = join(__dirname, "icons");

module.exports = {
  ...baseConfig({ appDir: __dirname }),
  appId: "org.parapluie.studio.engine-tray",
  productName: "st0-tray",
  mac: {
    category: "public.app-category.music",
    target: ["dmg"],
    icon: join(icons, "icon.icns"),
    // Unsigned, like the standalone: a partial signing gets the unsigned children SIGKILLed by Gatekeeper.
    identity: null,
    extendInfo: {
      // A menu-bar agent from the first frame, before the main process hides the Dock icon.
      LSUIElement: true,
      // Without it macOS never asks, and the engine this app launches records silence (docs/tray.md).
      NSMicrophoneUsageDescription:
        "st0 records the audio inputs of this machine onto the tracks you arm.",
    },
  },
  win: { target: ["nsis"], icon: join(icons, "icon.ico") },
  linux: {
    category: "Audio",
    target: ["deb", "AppImage"],
    icon: join(icons, "icon.png"),
  },
};
