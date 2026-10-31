// store.ts — the rehearsal recorder's data, in the store (db.ts): one module per entity under store/,
// and this, the one surface the routes import. A recording's BYTES live in the médiathèque, the store
// keeping its path (../docs/audio.md). What reads wrong: a short in-memory cache of rows stands
// between the routes and the store (store/helpers.ts).

export { linkToRecordings } from "./store/captures.ts";
export {
  momentSource,
  noteConsolidation,
} from "./store/consolidations.ts";
// Uploads land in the cache's own folder (UPLOAD_DIR), so keeping one is a rename, never a copy across filesystems.
export {
  CACHE_DIR as UPLOAD_DIR,
  discardUploads,
  startCacheSweeps,
} from "./store/helpers.ts";
export {
  addRecordingMarker,
  deleteRecordingMarker,
  updateRecordingMarker,
} from "./store/markers.ts";
export {
  addMoment,
  addMomentMarker,
  deleteMoment,
  deleteMomentMarker,
  dropClipCache,
  ensureMomentClipCached,
  extractClip as cutMomentClip,
  getMoment,
  listMoments,
  momentSharedFrom,
  recordingMoments,
  ServerOnlyError,
  updateMoment,
  updateMomentMarker,
  validateMoment,
} from "./store/moments.ts";
export {
  createPage,
  deletePage,
  getPage,
  getPageByNametag,
  getPageOwner,
  listPages,
  nametagExists,
  updatePage,
} from "./store/pages.ts";
export {
  createRelease,
  deleteRelease,
  getRelease,
  getReleaseBySongUuid,
  getReleaseOwner,
  listReleases,
  replaceVersionAudio,
  updateRelease,
} from "./store/releases.ts";
export {
  appendRecording,
  createSession,
  deleteRecording,
  deleteSession,
  ensureRecordingCached,
  getEnvelope,
  getOwner,
  getSession,
  listSessions,
  saveRecording,
} from "./store/sessions.ts";
export {
  createSingingExercise,
  deleteSingingExercise,
  getSingingExerciseOwner,
  listSingingExercises,
  updateSingingExercise,
} from "./store/singing.ts";
export {
  addVersion,
  deleteVersion,
  ensureVersionAudioCached,
  ensureVersionTrackCached,
  renameVersion,
  setDefaultVersion,
  setVersionHidden,
  versionEnvelope,
  versionFileName,
} from "./store/versions.ts";
