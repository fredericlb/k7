// RegisteredEngines.tsx — the engines this account may use at this origin, as the engine page lists them: the phone's
// own engine first inside the Android app, the hint that a computer's engine is set on that computer elsewhere,
// then the registry's card. On the tray it is a tab beside this machine's engine. See ../../docs/settings.md.

import { EnginesSettings } from "@studio/ui-library/settings";
import { m } from "../paraglide/messages.js";
import { MediaHost } from "../projects/MediaHost";
import { AndroidEngineSection } from "./AndroidEngineSection";
import { onAndroid } from "./androidEngine";

export function RegisteredEngines({ onTray }: { onTray: boolean }) {
  return (
    <>
      {/* On the phone the app is the engine's machine: this is where its engine is set. */}
      {onAndroid ? (
        <AndroidEngineSection />
      ) : (
        !onTray && (
          <p className="text-muted-foreground text-xs">
            {m["settings.trayHint"]()}
          </p>
        )
      )}
      {/* The media library's card, which reads its labels and its configured API. */}
      <MediaHost>
        <EnginesSettings />
      </MediaHost>
    </>
  );
}
