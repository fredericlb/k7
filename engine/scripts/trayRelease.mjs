// trayRelease.mjs — the tray's release files from what `tauri build` left in apps/k7-tray/src-tauri/target, named for
// a stamp like every other file of a release, plus one fragment of the updater's latest.json per platform, which
// tray-manifest.mjs merges in the publish job. See docs/app-downloads.md.

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Where tray.yml publishes; the updater's URLs point there, under the stamp's channel. */
export const DOWNLOADS = "https://k7.rocks/app_downloads";

/** Tauri's bundle folders, what each installer becomes, and the updater platform it serves, if any. */
const KINDS = [
  {
    dir: "nsis",
    match: /-setup\.exe$/,
    ext: ".exe",
    updater: "windows-x86_64",
  },
  { dir: "dmg", match: /\.dmg$/, ext: ".dmg" },
  {
    dir: "macos",
    match: /\.app\.tar\.gz$/,
    ext: ".app.tar.gz",
    updater: "darwin-aarch64",
  },
  {
    dir: "appimage",
    match: /\.AppImage$/,
    ext: ".AppImage",
    updater: "linux-x86_64",
  },
  { dir: "deb", match: /\.deb$/, ext: ".deb" },
];

/** `vX.Y.Z` follows `release`, anything else `snapshot`. */
export const channelOf = (stamp) =>
  /^v\d/.test(stamp) ? "release" : "snapshot";

/** Copy the installers into `release`, renamed; returns the updater fragment, or null when the build was not signed. */
export function packageTray({ bundle, release, stamp, platform, arch }) {
  const name = (ext) => `k7-tray_${stamp}_${platform}-${arch}${ext}`;
  const fragment = {};
  let found = 0;
  for (const k of KINDS) {
    const dir = join(bundle, k.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => k.match.test(f))) {
      copyFileSync(join(dir, f), join(release, name(k.ext)));
      console.log(`✔ ${join(release, name(k.ext))}`);
      found++;
      const sig = join(dir, `${f}.sig`);
      if (!k.updater || !existsSync(sig)) continue;
      fragment[k.updater] = {
        signature: readFileSync(sig, "utf8").trim(),
        url: `${DOWNLOADS}/tray/${channelOf(stamp)}/${name(k.ext)}`,
      };
    }
  }
  if (!found)
    throw new Error(
      `no installer under ${bundle} — run \`npm run tray:build --workspace k7-tray\` first`,
    );
  if (!Object.keys(fragment).length) return null;
  const at = join(release, `k7-tray-updater_${platform}-${arch}.json`);
  writeFileSync(at, `${JSON.stringify(fragment, null, 2)}\n`);
  console.log(`✔ ${at}`);
  return fragment;
}
