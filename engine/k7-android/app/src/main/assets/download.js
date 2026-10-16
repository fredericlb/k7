// download.js — a document-start script in a studio app's view (AppViewsPlugin.kt), and run again by its download listener:
// a file the page saves is fetched HERE, where a blob: URL resolves and the session cookie goes along, and handed to
// Downloads.kt over `k7Android` in acknowledged base64 chunks. An <a download> click on a blob:, data: or same-origin
// URL is taken before the WebView's own download, whose listener could no longer read a blob revoked meanwhile.
(() => {
  const bridge = window.k7Android;
  if (!bridge || window.top !== window || window.__k7Download) return;

  const CHUNK = 512 * 1024;
  const acks = new Map();
  let seq = 0;

  bridge.addEventListener("message", (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.t !== "dl-ack") return;
    const go = acks.get(m.id);
    acks.delete(m.id);
    if (go) go(m.ok === true);
  });

  const send = (msg) =>
    new Promise((resolve) => {
      acks.set(msg.id, resolve);
      bridge.postMessage(JSON.stringify(msg));
    });

  const base64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () =>
        resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  const nameFrom = (cd) => {
    if (!cd) return "";
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
      } catch {
        // A malformed escape: the plain filename below, if any.
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    return plain ? plain[1].trim() : "";
  };

  // fetch() is called before the first await, so a blob URL revoked right after the click is already resolved.
  window.__k7Download = async (url, name, type) => {
    const id = `${Date.now()}-${++seq}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime =
        type || (res.headers.get("content-type") || "").split(";")[0].trim();
      const start = {
        t: "dl-start",
        id,
        url: String(url).slice(0, 2048),
        type: mime,
      };
      start.name = name || nameFrom(res.headers.get("content-disposition"));
      if (!(await send(start))) return;
      const reader = res.body.getReader();
      let parts = [];
      let size = 0;
      const flush = async () => {
        if (size === 0) return true;
        const data = await base64(new Blob(parts));
        parts = [];
        size = 0;
        return send({ t: "dl-chunk", id, data });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        size += value.byteLength;
        if (size >= CHUNK && !(await flush())) return reader.cancel();
      }
      if (await flush()) await send({ t: "dl-end", id });
    } catch (e) {
      const message = String(e?.message || e);
      bridge.postMessage(
        JSON.stringify({ t: "dl-fail", id, name: name || "", message }),
      );
    }
  };

  // Which anchors are ours: a download of something only this page can read.
  const take = (a) => {
    if (
      !(a instanceof HTMLAnchorElement) ||
      !a.hasAttribute("download") ||
      !a.href
    )
      return false;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      return false;
    }
    if (u.protocol !== "data:" && u.origin !== location.origin) return false;
    window.__k7Download(a.href, a.getAttribute("download") || "", a.type || "");
    return true;
  };

  // Bubbling, on window: a page handler that cancelled the click keeps it cancelled.
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a =
      e.target instanceof Element ? e.target.closest("a[download]") : null;
    if (a && take(a)) e.preventDefault();
  });

  // An anchor clicked without being in the document dispatches no event the listener above could see.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected && take(this)) return;
    return click.call(this);
  };
})();
