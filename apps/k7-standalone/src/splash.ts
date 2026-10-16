// splash.ts — the page the home tab shows while the backend starts, and the one it shows if the start fails.
// A data URL, so it needs no server; it holds no link, so the tab's routing never sees it navigate. See docs/standalone.md.

/** --sh-background, --sh-foreground, --sh-muted-foreground and --sh-destructive, from the app's theme. */
const BACKGROUND = "#101114";
const FOREGROUND = "#e9e9ee";
const MUTED = "#92929e";
const ERROR = "#f16469";

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

function page(title: string, body: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html,body{margin:0;height:100%;background:${BACKGROUND};color:${FOREGROUND};font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:flex;align-items:center;justify-content:center;-webkit-app-region:drag;user-select:none}
main{max-width:36rem;padding:0 24px;text-align:center}
h1{font-size:18px;font-weight:600;margin:0 0 8px}
p{margin:0;color:${MUTED}}
pre{margin:16px 0 0;padding:12px;text-align:left;white-space:pre-wrap;word-break:break-word;color:${ERROR};background:#ffffff0a;border-radius:6px;font:12px/1.5 ui-monospace,monospace;-webkit-app-region:no-drag;user-select:text}
.dot{display:inline-block;width:6px;height:6px;margin:0 3px;border-radius:50%;background:${MUTED};animation:b 1.2s infinite ease-in-out both}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes b{0%,80%,100%{opacity:.2}40%{opacity:1}}
</style></head><body><main>${body}</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** What the window shows from its first frame until k7 answers. */
export function startingPage(): string {
  return page(
    "k7",
    `<h1>k7 is starting</h1><p>The first launch prepares the library and can take a while.</p><p style="margin-top:16px"><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>`,
  );
}

/** What it shows when the start failed: the reason, and the log to read. */
export function failedPage(why: string, logPath: string): string {
  return page(
    "k7 could not start",
    `<h1>k7 could not start</h1><p>Close this window to quit.</p><pre>${escapeHtml(why)}\n\nLog: ${escapeHtml(logPath)}</pre>`,
  );
}
