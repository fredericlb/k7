// media-session.js — run at document start in every studio app's view (AppViewsPlugin.kt). A WebView's Media Session
// reaches nothing outside it, so this copies what the page tells it to the app's native session (MediaPlayback.kt,
// `media`) and hands the system's buttons back to the page's own handlers (`media-action`). It also reports, as
// `busy`, a microphone the page holds open and a screen wake lock it holds (Busy.kt), and stands in for the Wake
// Lock API where the WebView has none. The iOS app injects it too (AppViews.swift). See docs/android.md.
(() => {
  const bridge = window.k7Android || window.k7Ios;
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

(() => {
  const bridge = window.k7Android || window.k7Ios;
  if (!bridge || window.__k7Busy) return;
  window.__k7Busy = true;

  const mics = new Set();
  const locks = new Set();
  let sent = "";
  let poll = 0;

  const report = () => {
    for (const t of mics) if (t.readyState !== "live") mics.delete(t);
    const reasons = [];
    if (mics.size) reasons.push("capture");
    if (locks.size) reasons.push("awake");
    if (mics.size && !poll) poll = setInterval(report, 5000);
    if (!mics.size && poll) {
      clearInterval(poll);
      poll = 0;
    }
    const key = reasons.join(",");
    if (key === sent) return;
    sent = key;
    bridge.postMessage(JSON.stringify({ t: "busy", from: "page", reasons }));
  };

  // A track stopped fires no `ended`, so stop() is watched too, and the poll catches the rest.
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const own = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      const stream = await own(constraints);
      for (const t of stream.getAudioTracks()) {
        mics.add(t);
        const stop = t.stop.bind(t);
        t.stop = () => {
          stop();
          report();
        };
        t.addEventListener("ended", report);
      }
      report();
      return stream;
    };
  }

  const held = (sentinel) => {
    locks.add(sentinel);
    sentinel.addEventListener("release", () => {
      locks.delete(sentinel);
      report();
    });
    report();
    return sentinel;
  };

  const wl = navigator.wakeLock;
  if (wl?.request) {
    const own = wl.request.bind(wl);
    wl.request = async (type) => held(await own(type));
  } else {
    // The API's shape, kept by the app's window flag: released on every hide, as a browser does.
    class Sentinel extends EventTarget {
      constructor() {
        super();
        this.type = "screen";
        this.released = false;
        this.onrelease = null;
      }
      release() {
        if (!this.released) {
          this.released = true;
          const e = new Event("release");
          this.dispatchEvent(e);
          if (this.onrelease) this.onrelease(e);
        }
        return Promise.resolve();
      }
    }
    const request = (type = "screen") => {
      if (type !== "screen")
        return Promise.reject(new TypeError(`no wake lock of type ${type}`));
      if (document.visibilityState !== "visible")
        return Promise.reject(
          new DOMException("the page is not visible", "NotAllowedError"),
        );
      return Promise.resolve(held(new Sentinel()));
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible")
        for (const s of [...locks]) s.release();
    });
  }

  addEventListener("pagehide", () => {
    mics.clear();
    locks.clear();
    report();
  });
})();
