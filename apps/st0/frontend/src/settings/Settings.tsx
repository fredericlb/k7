// Settings.tsx — what a BROWSER can set, at `/@settings`. Everything about the machine itself
// — the engine, the audio interface, the web UIs it trusts, autostart — is the tray's menu,
// because those need a process on that machine and this page is served to any of them.
// See ../../docs/settings.md.

import { SyncSection } from "./SyncSection";

export function Settings() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="font-medium text-lg text-neutral-100">Settings</h1>
        <p className="text-neutral-400 text-sm">
          The engine, the audio interface and this machine's own settings are in
          the tray's menu — they belong to a process on that machine. What is
          here is what any browser may change.
        </p>
        <SyncSection />
      </main>
    </div>
  );
}
