// media-session.js — run at document start in every studio app's view (AppViewsPlugin.kt). A WebView's Media Session
// reaches nothing outside it, so this copies what the page tells it to the app's native session (MediaPlayback.kt,
// `media`) and hands the system's buttons back to the page's own handlers (`media-action`). See docs/android.md.
(() => {
  const bridge = window.k7Android;
  const ms = navigator.mediaSession;
  if (!bridge || !ms || window.__k7Media) return;
  window.__k7Media = true;

  const handlers = new Map();
  let metadata = null;
  let state = "none";
  let position = null;
  let queued = false;

  // One message per task, however many fields the page set in a row.
  const send = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      bridge.postMessage(
        JSON.stringify({
          t: "media",
          title: metadata ? metadata.title : "",
          artist: metadata ? metadata.artist : "",
          album: metadata ? metadata.album : "",
          state,
          duration: position ? position.duration : 0,
          position: position ? position.position || 0 : 0,
          rate: position ? (position.playbackRate ?? 1) : 1,
          actions: [...handlers.keys()],
        }),
      );
    });
  };

  // Each setter still reaches the WebView's own session, so the page reads back what it wrote.
  const proto = Object.getPrototypeOf(ms);
  const relay = (name, keep) => {
    const own = Object.getOwnPropertyDescriptor(proto, name);
    if (!own) return;
    Object.defineProperty(ms, name, {
      configurable: true,
      get: () => own.get.call(ms),
      set: (v) => {
        own.set.call(ms, v);
        keep(v);
        send();
      },
    });
  };
  relay("metadata", (v) => {
    metadata = v;
  });
  relay("playbackState", (v) => {
    state = v;
  });

  const setPosition = ms.setPositionState ? ms.setPositionState.bind(ms) : null;
  ms.setPositionState = (p) => {
    if (setPosition) setPosition(p);
    position = p || null;
    send();
  };
  const setHandler = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (action, handler) => {
    setHandler(action, handler);
    if (handler) handlers.set(action, handler);
    else handlers.delete(action);
    send();
  };

  bridge.addEventListener("message", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t !== "media-action") return;
    const h = handlers.get(msg.action);
    if (h) h({ action: msg.action, seekTime: msg.seekTime });
  });

  // A page going away takes its controls with it, or the notification would drive a page that is gone.
  addEventListener("pagehide", () => {
    metadata = null;
    state = "none";
    position = null;
    handlers.clear();
    send();
  });
})();
