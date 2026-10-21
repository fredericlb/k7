// page.ts — /app_downloads, the one page where people get k7's apps: the release, then the latest build of main,
// then the tray's two. Server-rendered and self-contained (no SPA, no script), in French or English by Accept-Language.

import type { Channel, Release } from "./store.ts";

/** Each app's current build per channel, as the page lists them. */
export type ProductBuilds = Record<Channel, Release | null>;

// What the page offers, in this order; the rest (latest*.yml, blockmaps, SHA256SUMS) is the updater's or the curious's.
const KINDS = [
  { ext: ".exe", label: "Windows" },
  { ext: ".dmg", label: "macOS" },
  { ext: ".AppImage", label: "Linux (AppImage)" },
  { ext: ".deb", label: "Linux (.deb)" },
  { ext: ".apk", label: "Android" },
  { ext: ".zip", label: "Command-line engine" },
  { ext: ".tar.gz", label: "Command-line engine" },
];

// package-release.mjs names every file `<what>_<stamp>_<platform>-<arch>.<ext>`; the engine's label needs its platform.
const PLATFORMS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};
const platformOf = (name: string) => {
  const m = /_(windows|macos|linux)-(x64|arm64)\./.exec(name);
  return m ? `${PLATFORMS[m[1]]} ${m[2]}` : "";
};
const labelOf = (label: string, name: string) =>
  name.startsWith("k7-runtime_") ? `${label} (${platformOf(name)})` : label;

const LABELS = {
  en: {
    lang: "en",
    title: "k7 — downloads",
    release: "Release",
    snapshot: "Latest build of main",
    snapshotNote: "Built from every push to main: newer, less tested.",
    none: "No build published yet.",
    published: "published",
    updates:
      "The tray and the Android app update themselves; with the tray's .deb, download again from here.",
    sums: "Checksums",
    tray: "Tray",
    trayNote:
      "The engine alone, run from the menu bar, for a machine that plays what k7 sends it. It updates itself.",
  },
  fr: {
    lang: "fr",
    title: "k7 — téléchargements",
    release: "Version",
    snapshot: "Dernière build de main",
    snapshotNote:
      "Construite à chaque push sur main : plus récente, moins testée.",
    none: "Aucune build publiée pour l'instant.",
    published: "publiée le",
    updates:
      "Le tray et l'app Android se mettent à jour seuls ; avec le .deb du tray, retéléchargez ici.",
    sums: "Sommes de contrôle",
    tray: "Tray",
    trayNote:
      "Le moteur seul, lancé depuis la barre de menus, pour une machine qui joue ce que k7 lui envoie. Il se met à jour seul.",
  },
};

type Labels = (typeof LABELS)["en"];

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const megabytes = (bytes: number) =>
  `${Math.max(1, Math.round(bytes / 1048576))} MB`;

type Product = "main" | "tray";

// The tray's feed sits under tray/, as routes.ts mounts it.
const hrefOf = (product: Product, channel: Channel, name: string) =>
  `app_downloads/${product === "tray" ? "tray/" : ""}${channel}/${encodeURIComponent(name)}`;

function section(
  product: Product,
  channel: Channel,
  r: Release | null,
  t: Labels,
): string {
  if (!r) return "";
  const href = (name: string) => hrefOf(product, channel, name);
  const items = KINDS.flatMap(({ ext, label }) =>
    r.files
      // The tray's macOS update archive is the updater's, not a download: it ends in .tar.gz like an engine.
      .filter((f) => f.name.endsWith(ext) && !f.name.endsWith(".app.tar.gz"))
      .map(
        (f) =>
          `<li><a href="${href(f.name)}">${escapeHtml(labelOf(label, f.name))}</a><span>${escapeHtml(f.name)} · ${megabytes(f.bytes)}</span></li>`,
      ),
  );
  const when = new Date(r.publishedAt).toLocaleString(t.lang, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });
  const which =
    channel === "release" ? `${t.release} ${r.stamp.slice(1)}` : t.snapshot;
  const name = product === "tray" ? `${t.tray} — ${which}` : which;
  const note =
    (product === "tray" ? `<p>${t.trayNote}</p>` : "") +
    (channel === "snapshot" ? `<p>${t.snapshotNote}</p>` : "");
  const sums = r.files.some((f) => f.name === "SHA256SUMS")
    ? `<p class="small"><a href="${href("SHA256SUMS")}">${t.sums}</a></p>`
    : "";
  return `<section><h2>${escapeHtml(name)}</h2><p class="small">${escapeHtml(r.stamp)}, ${t.published} ${escapeHtml(when)}</p>${note}<ul>${items.join("")}</ul>${sums}</section>`;
}

export function downloadsPage(
  builds: Record<Product, ProductBuilds>,
  french: boolean,
): string {
  const t = french ? LABELS.fr : LABELS.en;
  const sections = (["main", "tray"] as const)
    .flatMap((p) =>
      (["release", "snapshot"] as const).map((c) =>
        section(p, c, builds[p][c], t),
      ),
    )
    .join("");
  const body = sections
    ? `${sections}<p class="small">${t.updates}</p>`
    : `<p>${t.none}</p>`;
  return `<!doctype html>
<html lang="${t.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1c1e;--muted:#6b6b70;--link:#1d5fd1;--line:#e4e4e8}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--muted:#9a9aa0;--link:#7aa7ff;--line:#2c2c30}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 16px}
h1{font-size:1.5rem}h2{font-size:1.125rem;margin:0}section{border-top:1px solid var(--line);padding:1.25rem 0}
ul{list-style:none;padding:0;margin:.5rem 0 0}li{margin:.6rem 0}p{color:var(--muted);margin:.25rem 0}
a{color:var(--link);font-weight:600}span{display:block;color:var(--muted);font-size:.875rem;overflow-wrap:anywhere}.small{font-size:.875rem}
</style></head>
<body><h1>${t.title}</h1>${body}</body></html>`;
}
