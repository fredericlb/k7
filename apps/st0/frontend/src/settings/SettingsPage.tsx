// SettingsPage.tsx — `/settings`, a page of its own: what a BROWSER may change — the language,
// the chains, the AI key, the paired devices, the registered engines and the
// hunt's slskd access, the rehearsal pages' token — and on the phone, this phone's engine.
// A page and not a panel: it is visited on purpose and rarely. See ../../docs/settings.md.

import { EnginesSettings, SlskdSettings } from "@studio/ui-library/settings";
import { lazy, Suspense } from "react";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { MediaHost } from "../projects/MediaHost";
import { AiSection } from "./AiSection";
import { AndroidEngineSection } from "./AndroidEngineSection";
import { onAndroid } from "./androidEngine";
import { ChainsSection } from "./ChainsSection";
import { LanguageSection } from "./LanguageSection";
import { PairedDevicesSection } from "./PairedDevicesSection";

/** The rehearsal pages' section, with their stylesheet: a chunk of its own, fetched with this page only. */
const RehearsalSettings = lazy(() =>
  import("@studio/ui-rehearsal/settings").then((x) => ({
    default: x.RehearsalSettings,
  })),
);

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
          <ChainsSection />
          <AiSection />
          <PairedDevicesSection />
          {/* The media library's two cards, which read its labels and its configured API. */}
          <MediaHost>
            <EnginesSettings />
            <SlskdSettings />
          </MediaHost>
          <Suspense fallback={null}>
            <RehearsalSettings />
          </Suspense>
        </div>
      </div>
    </HomeShell>
  );
}
