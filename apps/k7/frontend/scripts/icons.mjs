// Renders icon/k7.svg into every platform's app icon (web, desktop, Android, iOS, the engine's window), and icon/k7-splash.svg into each startup splash.
// Run by hand after changing the SVG: node apps/k7/frontend/scripts/icons.mjs (apps/k7/frontend/docs/icons.md).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(frontend, "..", "..", "..");
const svg = readFileSync(join(frontend, "icon", "k7.svg"), "utf8").replace(
  /^<\?xml[^>]*>\s*/,
  "",
);

// tile: the rounded dark square; bleed: the splash's #07031F to the edges, a phone masks it; none: transparent.
const SHAPES = {
  tile: "background:#000;border-radius:22%",
  bleed: "background:#07031F",
  none: "",
};

const TARGETS = [
  {
    out: "apps/k7/frontend/public/icon-512.png",
    size: 512,
    shape: "tile",
    width: 0.78,
  },
  {
    out: "apps/k7/frontend/public/icon-192.png",
    size: 192,
    shape: "tile",
    width: 0.78,
  },
  // The desktop: the cassette alone on transparency, for the app's bundle and window, and the engine's plugin windows.
  {
    out: "apps/k7/frontend/public/icon-desktop.png",
    size: 1024,
    shape: "none",
    width: 0.92,
  },
  {
    out: "engine/k7-runtime/engine/resources/studio_icon.png",
    size: 192,
    shape: "none",
    width: 0.92,
  },
  // Maskable: the cassette's diagonal stays inside the 80% circle every mask keeps.
  {
    out: "apps/k7/frontend/public/icon-512-maskable.png",
    size: 512,
    shape: "bleed",
    width: 0.6,
  },
  {
    out: "apps/k7/frontend/public/icon-192-maskable.png",
    size: 192,
    shape: "bleed",
    width: 0.6,
  },
  {
    out: "apps/k7/frontend/public/apple-touch-icon.png",
    size: 180,
    shape: "bleed",
    width: 0.78,
  },
  {
    out: "engine/k7-ios/k7/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
    size: 1024,
    shape: "bleed",
    width: 0.78,
  },
  // Adaptive foreground: 108dp canvas, the cassette inside the 72dp circle; ic_launcher.xml paints the #07031F.
  {
    out: "engine/k7-android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
    size: 432,
    shape: "none",
    width: 0.5,
  },
];

const FAVICON_SIZES = [16, 32, 48];

// The startup splash, drawn transparent: each platform paints #07031F behind it (apps/k7/frontend/docs/icons.md).
const splashSvg = readFileSync(
  join(frontend, "icon", "k7-splash.svg"),
  "utf8",
).replace(/^<\?xml[^>]*>\s*/, "");
const SPLASH_TARGETS = [
  {
    out: "engine/k7-android/app/src/main/res/drawable-nodpi/splash_art.png",
    width: 960,
  },
  {
    out: "engine/k7-ios/k7/Assets.xcassets/Splash.imageset/splash@2x.png",
    width: 560,
  },
  {
    out: "engine/k7-ios/k7/Assets.xcassets/Splash.imageset/splash@3x.png",
    width: 840,
  },
];
// The pages that fetch nothing carry the drawing inline (the desktop splash, k7.rocks), minus the namespaces HTML does not need.
const SPLASH_INLINE = "apps/k7/frontend/icon/k7-splash.inline.json";

async function renderSplash(browser, width) {
  const tab = await browser.newPage({ viewport: { width, height: width } });
  await tab.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${splashSvg.replace("<svg ", `<svg style="display:block;width:${width}px;height:auto" `)}</body></html>`,
  );
  const png = await tab.locator("svg").screenshot({ omitBackground: true });
  await tab.close();
  return png;
}

function inlineSplash() {
  return splashSvg
    .replace(/\s+xmlns(:\w+)?="[^"]*"/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function page(size, shape, width) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;${SHAPES[shape]}">
<div style="width:${width * 100}%">${svg.replace("<svg ", '<svg style="display:block;width:100%;height:auto;overflow:visible" ')}</div>
</div></body></html>`;
}

async function render(browser, size, shape, width) {
  const tab = await browser.newPage({
    viewport: { width: size, height: size },
  });
  await tab.setContent(page(size, shape, width));
  const png = await tab.screenshot({ omitBackground: true });
  await tab.close();
  return png;
}

// An ICO holding PNG images, which every browser reads.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

const browser = await launch();
try {
  for (const { out, size, shape, width } of TARGETS) {
    writeFileSync(join(repo, out), await render(browser, size, shape, width));
    console.log(out);
  }
  const favicons = [];
  for (const size of FAVICON_SIZES)
    favicons.push({ size, png: await render(browser, size, "none", 1) });
  writeFileSync(join(frontend, "public", "favicon.ico"), ico(favicons));
  console.log("apps/k7/frontend/public/favicon.ico");
  for (const { out, width } of SPLASH_TARGETS) {
    mkdirSync(dirname(join(repo, out)), { recursive: true });
    writeFileSync(join(repo, out), await renderSplash(browser, width));
    console.log(out);
  }
  writeFileSync(
    join(repo, SPLASH_INLINE),
    `${JSON.stringify({ svg: inlineSplash() }, null, 2)}\n`,
  );
  console.log(SPLASH_INLINE);
} finally {
  await browser.close();
}
