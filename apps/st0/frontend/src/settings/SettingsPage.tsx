// SettingsPage.tsx — `/settings`, a page of its own: what a BROWSER may change — the language,
// the deploy key, the chains, the AI key, the paired devices — and on the phone, this phone's engine.
// A page and not a panel: it is visited on purpose and rarely. See ../../docs/settings.md.

import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { AiSection } from "./AiSection";
import { AndroidEngineSection } from "./AndroidEngineSection";
import { onAndroid } from "./androidEngine";
import { ChainsSection } from "./ChainsSection";
import { LanguageSection } from "./LanguageSection";
import { PairedDevicesSection } from "./PairedDevicesSection";
import { SyncSection } from "./SyncSection";

export function SettingsPage() {
  return (
    <HomeShell subtitle={m["settings.title"]()}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
          {/* On the phone there is no tray: this page is where its engine is set. */}
          {onAndroid ? (
            <AndroidEngineSection />
          ) : (
            <p className="text-muted-foreground text-xs">
              {m["settings.trayHint"]()}
            </p>
          )}
          <LanguageSection />
          <SyncSection />
          <ChainsSection />
          <AiSection />
          <PairedDevicesSection />
        </div>
      </div>
    </HomeShell>
  );
}
