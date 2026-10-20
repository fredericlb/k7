// ShellContexts.tsx — the two stores every pane under the shell reads for itself: the engine's
// live state and the shell's own. One element, so the shell's tree keeps a single wrapper.

import type { EngineStore } from "@studio/engine-browser/store";
import { EngineStoreProvider } from "@studio/engine-browser/store";
import type { ReactNode } from "react";
import { type ShellStore, ShellStoreContext } from "./shellStore";

export function ShellContexts({
  shell,
  engine,
  children,
}: {
  shell: ShellStore;
  engine: EngineStore;
  children: ReactNode;
}) {
  return (
    <ShellStoreContext.Provider value={shell}>
      <EngineStoreProvider value={engine}>{children}</EngineStoreProvider>
    </ShellStoreContext.Provider>
  );
}
