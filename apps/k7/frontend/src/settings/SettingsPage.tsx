// SettingsPage.tsx — `/settings`, a page of its own: what a BROWSER may change for its account, under three tabs —
// General (the language, the chains, the AI key), Devices (the paired devices, live sync's pairings) and Media (the
// rehearsal pages' token). The engines and the server's own settings are pages of their own beside it, in the user
// menu. A page and not a panel: it is visited on purpose and rarely. See ../../docs/settings.md.

import { lazy, Suspense } from "react";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { PageFrame } from "../projects/PageFrame";
import { AiSection } from "./AiSection";
import { ChainsSection } from "./ChainsSection";
import { LanguageSection } from "./LanguageSection";
import { PairedDevicesSection } from "./PairedDevicesSection";
import { type SettingsTab, SettingsTabs } from "./SettingsTabs";
import { SyncDevicesSection } from "./SyncDevicesSection";

/** The rehearsal pages' section, with their stylesheet: a chunk of its own, fetched with this page only. */
const RehearsalSettings = lazy(() =>
  import("@studio/ui-rehearsal/settings").then((x) => ({
    default: x.RehearsalSettings,
  })),
);

export function SettingsPage() {
  const general: SettingsTab = {
    key: "general",
    label: m["settings.tabGeneral"](),
    content: (
      <>
        <LanguageSection />
        <ChainsSection />
        <AiSection />
      </>
    ),
  };
  const devices: SettingsTab = {
    key: "devices",
    label: m["settings.tabDevices"](),
    content: (
      <>
        <PairedDevicesSection />
        <SyncDevicesSection />
      </>
    ),
  };
  const media: SettingsTab = {
    key: "media",
    label: m["settings.tabMedia"](),
    content: (
      <Suspense fallback={null}>
        <RehearsalSettings />
      </Suspense>
    ),
  };
  return (
    <HomeShell>
      <PageFrame title={m["settings.title"]()} narrow>
        <SettingsTabs tabs={[general, devices, media]} />
      </PageFrame>
    </HomeShell>
  );
}
