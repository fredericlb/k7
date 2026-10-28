// appNav.ts — going between k7's addresses WITHOUT a page load. The router stays mounted by its
// scope (address.ts); crossing to another scope swaps the whole tree under it, which is what the
// page load used to do — so what a load used to forget has to be forgotten here (`onLeave`). The
// one thing a reader would get wrong: a link crossing scopes is caught at the document, because a
// router only writes below its own basename. See ../docs/shell.md.

import { resetFileApi } from "@studio/project-shell/fileApi";
import { setAddressNavigator } from "@studio/project-shell/launch";
import {
  flushAutosaves,
  forgetBuffers,
} from "@studio/ui-editor/autosave-buffers";
import { hasUnsavedWork } from "@studio/ui-editor/unsaved";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isAppAddress, scopeOf } from "./address";
import { m } from "./paraglide/messages.js";
import { queryClient } from "./queries/client";
import { onLeave } from "./scopeLeave";

const BASE = import.meta.env.BASE_URL;

/** The scope the address names now. */
export const currentScopeKey = (): string =>
  scopeOf(window.location.pathname, BASE).key;

const listeners = new Set<() => void>();
// The page-wide state every project leaves behind; modules holding their own register beside these.
onLeave(resetFileApi);
onLeave(forgetBuffers);
onLeave(() => queryClient.clear());

/** Hear the address cross into another scope — Root's re-render. */
export function subscribeAddress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Set while `go` replays its own move as a popstate, which is no Back to refuse.
let selfPop = false;

// What was on screen before the last move, to put back when a Back is refused.
let lastKey = currentScopeKey();
let lastHref = window.location.href;
let lastState: unknown = window.history.state;

function settle(): void {
  const key = currentScopeKey();
  const crossed = key !== lastKey;
  lastKey = key;
  lastHref = window.location.href;
  lastState = window.history.state;
  if (crossed) for (const l of listeners) l();
}

/** The browser's own prompt, said in the app: leaving loses what is not on disk. */
const mayLeave = (): boolean =>
  !hasUnsavedWork() || window.confirm(m["leave.unsaved"]());

/** Go to `href`: drawn in place when it is one of this page's addresses, loaded otherwise. */
export async function go(href: string, replace = false): Promise<void> {
  const url = new URL(href, window.location.href);
  if (!isAppAddress(url, window.location.origin, BASE)) {
    if (replace) window.location.replace(url.href);
    else window.location.assign(url.href);
    return;
  }
  const crossing = scopeOf(url.pathname, BASE).key !== lastKey;
  if (crossing) {
    // Typing still on its timer is written first, so only what truly cannot be is asked about.
    await flushAutosaves().catch(() => false);
    if (!mayLeave()) return;
  }
  // The router's own entry shape, so its Back and Forward keep counting (react-router's `idx`).
  const idx =
    ((window.history.state as { idx?: number } | null)?.idx ?? 0) +
    (replace ? 0 : 1);
  const state = {
    usr: null,
    key: Math.random().toString(36).slice(2, 10),
    idx,
  };
  if (replace) window.history.replaceState(state, "", url.href);
  else window.history.pushState(state, "", url.href);
  // Crossing, the next scope's router reads the address as it mounts; the one leaving must not hear it.
  if (crossing) {
    settle();
    return;
  }
  selfPop = true;
  try {
    // A router mounted on this scope reads the move off this event, as it would off Back.
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  } finally {
    selfPop = false;
  }
}

// Registered at import, before any router: a refused Back must be undone before a router hears it.
window.addEventListener("popstate", (e) => {
  if (!selfPop && currentScopeKey() !== lastKey && !mayLeave()) {
    window.history.pushState(lastState, "", lastHref);
    e.stopImmediatePropagation();
    return;
  }
  settle();
});

// A same-origin link to another scope is drawn in place; a router's own link has already said so.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a?.href || a.hasAttribute("download")) return;
  if (a.target && a.target !== "_self") return;
  const url = new URL(a.href);
  if (url.pathname === window.location.pathname && url.hash) return;
  if (!isAppAddress(url, window.location.origin, BASE)) return;
  e.preventDefault();
  void go(url.href);
});

// The gate's Quit and its way out of a project-less address come through here too.
setAddressNavigator((url, replace) => void go(url, replace));

/** Inside a router: a move it made on its own that crossed scopes is announced like any other. */
export function useScopeWatch(): void {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger; the scope is read off the window.
  useEffect(settle, [pathname]);
}
