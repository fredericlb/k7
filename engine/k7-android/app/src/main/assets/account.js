// account.js — run in every studio app's view once its page has loaded (AppViewsPlugin.kt): reports who is signed in,
// which the bar over the views shows (StudioBridge.kt, `account`). Asked again whenever the page comes back to the front.
(() => {
  const bridge = window.k7Android;
  if (!bridge || window.__k7Account) return;
  window.__k7Account = true;

  const ask = () =>
    fetch("/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((j) => {
        const u = j.user;
        const name = u ? u.name || u.email || u.sub || "" : null;
        bridge.postMessage(JSON.stringify({ t: "account", name }));
      })
      .catch(() => {});

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ask();
  });
  ask();
})();
