// SettingsPage.tsx — `/settings`, a page of its own: what a BROWSER may change, under four tabs — General (the
// language, the chains, the AI key), Devices (the paired devices, live sync's pairings), Engines (the registered
// engines, and on the phone this phone's engine) and Media (the hunt's slskd access, the rehearsal pages' token).
// A page and not a panel: it is visited on purpose and rarely. See ../../docs/settings.md.

import {
  EngineOwnersSettings,
  EnginesSettings,
  SlskdSettings,
} from "@studio/ui-library/settings";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { ENGINE_SETTINGS_ROUTE } from "../projects/api";
import { HomeShell } from "../projects/HomeSidebar";
import { MediaHost } from "../projects/MediaHost";
import { PageFrame } from "../projects/PageFrame";
import { AiSection } from "./AiSection";
import { AndroidEngineSection } from "./AndroidEngineSection";
import { onAndroid } from "./androidEngine";
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
  const local = useLocalApp();
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
  const engines: SettingsTab = {
    key: "engines",
    label: m["settings.tabEngines"](),
    content: (
      <>
        {/* On the phone the app is the engine's machine: this tab is where its engine is set. */}
        {/* Served by the tray's backend: this machine's engine has a page of its own. */}
        {onAndroid ? (
          <AndroidEngineSection />
        ) : local?.engine ? (
          <p className="text-muted-foreground text-xs">
            <Link className="underline" to={ENGINE_SETTINGS_ROUTE}>
              {m["settings.engineHere"]()}
            </Link>
            {" · "}
            {m["settings.desktopVersion"]({ version: local.version })}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {m["settings.trayHint"]()}
          </p>
        )}
        {/* The media library's card, which reads its labels and its configured API. */}
        <MediaHost>
          <EnginesSettings />
          {/* Admins only: a 403 draws nothing. */}
          <EngineOwnersSettings />
        </MediaHost>
      </>
    ),
  };
  const media: SettingsTab = {
    key: "media",
    label: m["settings.tabMedia"](),
    content: (
      <>
        <MediaHost>
          <SlskdSettings />
        </MediaHost>
        <Suspense fallback={null}>
          <RehearsalSettings />
        </Suspense>
      </>
    ),
  };
  return (
    <HomeShell>
      <PageFrame title={m["settings.title"]()} narrow>
        {/* The phone's engine is what its user comes here for, so its tab leads there. */}
        <SettingsTabs
          tabs={
            onAndroid
              ? [engines, general, devices, media]
              : [general, devices, engines, media]
          }
        />
      </PageFrame>
    </HomeShell>
  );
}
