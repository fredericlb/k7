// preload.ts — tells every page where the app's services answer, before any of its scripts runs.
// The pages derive the services' addresses synchronously at import time, so this cannot wait for a fetch (packages/web-protocol/services.ts).

import { contextBridge } from "electron";

const PREFIX = "--studio-ports=";
const spec = process.argv
  .find((a) => a.startsWith(PREFIX))
  ?.slice(PREFIX.length);
if (spec) contextBridge.exposeInMainWorld("__STUDIO_PORTS__", spec);
