// server.ts — the SERVER composition half: what the file-service installs at boot, before
// anything reads a catalogue or compiles a song. It imports NO browser half — the desk's
// drawer and its JSX stay out of the server's program entirely (docs/plugins.md).

import { installServerPlugins } from "@studio/st0-sdk/install";
import type { St0Plugin } from "@studio/st0-sdk/plugin";
import { transcriptionPlugin } from "./transcription";

export const BUILTIN_PLUGINS: St0Plugin[] = [transcriptionPlugin];

export function installBuiltinPlugins(): void {
  installServerPlugins(BUILTIN_PLUGINS);
}
