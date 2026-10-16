// notices.ts — the supervisor's and the engine's notable events as OS notifications, rate-limited per kind.
// The pages hear the same state over `studio:engine` (engineBridge.ts); this is for the person looking elsewhere. See docs/notices.md.

import { line } from "@frediverse/electron-shell/log";
import type {
  NotifyFrame,
  Snapshot,
} from "@studio/supervisor-host/hostProtocol";
import { app, dialog, Notification } from "electron";
import {
  downNotice,
  type Notice,
  RateLimit,
  snapshotNotice,
} from "./engineNotices.ts";

const limit = new RateLimit(5 * 60_000);
let prev: Snapshot | null = null;
let quitting = false;
// A quit stops the engine on purpose: the person must not be told it stopped.
app.once("before-quit", () => {
  quitting = true;
});

function show(n: Notice | null): void {
  if (!n || quitting || !limit.allow(n.key, Date.now())) return;
  line("app", `notice: ${n.title}: ${n.body}`);
  if (!Notification.isSupported()) return;
  new Notification({ title: n.title, body: n.body, silent: true }).show();
}

export function noticeSnapshot(s: Snapshot): void {
  show(snapshotNotice(prev, s));
  prev = s;
}

export function noticeDown(why: string | null): void {
  show(downNotice(why));
}

/** What the supervisor asks to tell: `modal` as a dialog that blocks nothing, anything else as a notification. */
export function noticeFrame(f: NotifyFrame): void {
  if (f.kind !== "modal") {
    show({ key: `notify:${f.title}`, title: f.title, body: f.body });
    return;
  }
  if (quitting || !limit.allow(`modal:${f.title}`, Date.now())) return;
  void dialog.showMessageBox({
    type: "warning",
    title: "k7",
    message: f.title,
    detail: f.body,
  });
}

/** No supervisor in this build: k7 runs, and nothing plays. */
export function noticeNoEngine(): void {
  show({
    key: "no-supervisor",
    title: "k7 runs without its audio engine",
    body: "This build has no k7-supervisor, so nothing can play. The log says where it was looked for.",
  });
}
