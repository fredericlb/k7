// mirror-termux-debs.mjs — copies every pinned Termux .deb into the project's `termux-debs` prerelease.
// Run by hand after a re-pin, before the pool drops those versions; it needs `gh` signed in with write access.
// The release is a prerelease never marked latest, since an update check reading releases/latest must never land on it.
// Assets already there are kept, never replaced: a pin's name always means the same bytes.
// Usage: node mirror-termux-debs.mjs [--dry-run]. See engine/k7-runtime/docs/android.md.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetName,
  fetchDeb,
  MIRROR_REPO,
  MIRROR_TAG,
  PACKAGES,
  readPins,
} from "./termux-debs.mjs";

const dryRun = process.argv.includes("--dry-run");
const gh = (...args) =>
  execFileSync("gh", [...args, "-R", MIRROR_REPO], { encoding: "utf8" });

/** The release's asset names, or null when it does not exist yet. */
function assets() {
  try {
    return new Set(
      JSON.parse(
        gh("release", "view", MIRROR_TAG, "--json", "assets"),
      ).assets.map((a) => a.name),
    );
  } catch {
    return null;
  }
}

const pinned = readPins();
const have = assets();
const wanted = PACKAGES.map((name) => pinned[name]).filter(
  (pin) => !have?.has(assetName(pin.file)),
);
if (have && !wanted.length) {
  console.log(
    `${MIRROR_REPO}@${MIRROR_TAG}: every pinned deb is already there`,
  );
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "termux-debs-"));
try {
  const files = [];
  for (const pin of wanted) files.push(await fetchDeb(dir, pin));
  console.log(`${files.length} debs verified:\n  ${files.join("\n  ")}`);
  if (!dryRun && !have)
    gh(
      "release",
      "create",
      MIRROR_TAG,
      "--prerelease",
      "--latest=false",
      "--title",
      "Termux debs (build input)",
      "--notes",
      "The Termux packages engine/k7-android/scripts/termux-packages.json pins, each verified by its SHA-256. A build input, not a k7 release.",
    );
  if (!dryRun) {
    gh("release", "upload", MIRROR_TAG, ...files);
    console.log(`${MIRROR_REPO}@${MIRROR_TAG}: ${files.length} debs uploaded`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
