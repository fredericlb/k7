// loader.ts — shared helpers for reading a k7x folder project: each subdirectory holds one flat file per
// entity, keyed by filename, and the root holds project/settings/chains. Read in-process and validated with
// Zod, which carries the file, line and column of a bad key into the diagnostics.
// The readers themselves live in entities, moduleTree, moduleRefs, moduleAssetFiles, diagnostics and
// projectFiles; this module re-exports them, being where every caller looks.

import {
  categoryForRole,
  FILE_PARAMS,
  isFileParam,
  MODULE_EMITS,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
  NODE_SEP,
  slugifyPluginName,
  splitModuleKey,
} from "@studio/song-schema/moduleTypes";
import { MODULE_ASSETS_DIR, MODULE_SOURCES_DIR } from "./assetPath";
import { withModuleStamp } from "./moduleCache";

export {
  type Diagnostic,
  deadProjectFields,
  libraryModuleIssues,
  notSupportedModules,
  unknownPluginModules,
} from "./diagnostics";
export {
  checkProjectFormat,
  exportSub,
  isVideoSource,
  loadChains,
  loadCuedSongs,
  loadLanes,
  loadProjectRoot,
  loadSettings,
  loadVideoTracks,
  readsAsPicture,
  readYamlEntities,
} from "./entities";
export {
  listModuleAssets,
  resolveAssets,
  resolveModuleAsset,
  resolveRackAudio,
} from "./moduleAssetFiles";
export {
  type BaseModuleRef,
  baseModuleRefs,
  listBaseModuleRefs,
  listBaseModules,
  loadModuleRefs,
  panelOf,
  projectModules,
  withChainModuleRefs,
} from "./moduleRefs";
export {
  KNOWN_PLUGIN_TYPES,
  loadModules,
  moduleOwnRefs,
  NODES_DIR,
} from "./moduleTree";
export {
  cloneModuleFile,
  createIoModuleFile,
  createModuleFile,
  createNode,
  createSequenceFile,
  createTrackFile,
  createVideoTrackFile,
  freeNodeName,
  nodeNameTaken,
  setLaneOrder,
} from "./projectFiles";
// The module vocabulary lives in moduleTypes.ts, a leaf with no filesystem; re-exported here where every consumer looks.
/** Where a module keeps the files it loads: defined in assetPath.ts, re-exported here where every caller already looks. */
// One module-stamp walk for a series of reads, re-exported from moduleCache.ts — usable only by a caller that WRITES nothing.
export {
  categoryForRole,
  FILE_PARAMS,
  // …and the question every writer of one asks: is this param's value a FILE?
  isFileParam,
  MODULE_ASSETS_DIR,
  MODULE_EMITS,
  MODULE_SOURCES_DIR,
  MODULE_TYPES,
  moduleEmits,
  moduleKey,
  moduleRefOf,
  NODE_SEP,
  slugifyPluginName,
  splitModuleKey,
  withModuleStamp,
};
