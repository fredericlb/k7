// surfacePanesSeed.ts — the shell's OWN core panes, registered as the seed of the pane registry.
// The desk (turntables) is NOT here: it moved to the turntables plugin, whose drawers arrive
// through BROWSER_PLUGINS. One file so the shell's half reads as ONE act, and so a test can
// assert every declared type is answered — by the seed or by a plugin (docs/plugins.md).

import { ExternalTimeline } from "./components/ExternalTimeline";
import { MasteringTab } from "./components/MasteringTab";
import { type DeviceSurfaceCtx, registerSurfacePane } from "./surfacePanes";

// A device's timeline needs the handle the ctx carries — passed through, never rebuilt.
const timelineDevice = (ctx: DeviceSurfaceCtx) => (
  <ExternalTimeline
    ref={ctx.timelineRef}
    project={ctx.project}
    store={ctx.store}
    engineRef={ctx.engineRef}
    seek={ctx.seek}
    commands={ctx.commands}
    setStatus={ctx.setStatus}
    videoDoc={ctx.videoDoc}
    prefs={ctx.prefs}
    catalogue={ctx.catalogue}
    prewrite={ctx.prewrite}
    onConditions={ctx.onConditions}
  />
);

export function seedSurfacePanes(): void {
  registerSurfacePane({ type: "timeline", device: timelineDevice });
  registerSurfacePane({
    type: "mastering",
    device: (ctx) => (
      <MasteringTab
        surface={ctx.surface}
        paramsStore={ctx.paramsStore}
        setPluginParam={ctx.setPluginParam}
        watchPluginParams={ctx.watchPluginParams}
      />
    ),
  });
}
