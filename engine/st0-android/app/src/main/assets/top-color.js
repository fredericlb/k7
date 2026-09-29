// top-color.js — run in every studio app's view once its page has loaded (AppViewsPlugin.kt): reports the
// colour at the top of the page, which paints the status bar above it (StudioBridge.kt, `color`).
// The colour is COMPOSITED, not read: AppHeader's tint is the primary at 20% over the page, so the pixel
// is every layer under the top edge laid on a 1px canvas, which also resolves oklch and color-mix.
(() => {
  const bridge = window.st0Android;
  if (!bridge || window.__st0TopColor) return;
  window.__st0TopColor = true;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  let last = "";
  let queued = false;

  const sample = () => {
    queued = false;
    const layers = [];
    for (let el = document.elementFromPoint(innerWidth / 2, 0); el; el = el.parentElement)
      layers.push(getComputedStyle(el).backgroundColor);
    // A page that paints nothing shows the WebView's white.
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 1, 1);
    for (const color of layers.reverse()) {
      g.fillStyle = color;
      g.fillRect(0, 0, 1, 1);
    }
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    const hex = `#${[r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    if (hex === last) return;
    last = hex;
    bridge.postMessage(JSON.stringify({ t: "color", value: hex }));
  };

  // At most once a frame: a route change or a theme switch, not every meter's style write.
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sample);
  };

  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  new MutationObserver(queue).observe(document.documentElement, { attributes: true });
  if (document.body) new MutationObserver(queue).observe(document.body, { attributes: true });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", queue);
  addEventListener("resize", queue);
  queue();
})();
