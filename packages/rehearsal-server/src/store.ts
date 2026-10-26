// store.ts — the rehearsal recorder's data, in the store (db.ts): one module per entity under store/,
// and this, the one surface the routes import. A recording's BYTES live in the médiathèque, the store
// keeping its path (../docs/audio.md). What reads wrong: a short in-memory cache of rows stands
// between the routes and the store (store/helpers.ts).

// Uploads land in the cache's own folder (UPLOAD_DIR), so keeping one is a rename, never a copy across filesystems.
export {
  CACHE_DIR as UPLOAD_DIR,
  discardUploads,
  startCacheSweeps,
} from "./store/helpers.ts";
export {
  addAnnotation,
  addMomentMarker,
  deleteAnnotation,
  deleteMoment,
  deleteMomentMarker,
  dropClipCache,
  ensureClipCached,
  ensureMomentClipCached,
  getMoment,
  listMoments,
  momentSharedFrom,
  updateAnnotation,
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
  addMarker,
  appendRecording,
  createSession,
  deleteMarker,
  deleteSession,
  ensureRecordingCached,
  getEnvelope,
  getOwner,
  getSession,
  listSessions,
  saveRecording,
  updateMarker,
} from "./store/sessions.ts";
export {
  createSingingExercise,
  deleteSingingExercise,
  getSingingExerciseOwner,
  listSingingExercises,
  updateSingingExercise,
} from "./store/singing.ts";
export {
  addSheetFiles,
  deleteSheetFile,
  deleteSongInstrumental,
  ensureSheetFileCached,
  linkSongAudio,
  linkSongInstrumental,
  setSongAudio,
  songEnvelope,
  unlinkSongAudio,
} from "./store/songMedia.ts";
export {
  createSong,
  deleteSong,
  getSong,
  listSongs,
  setSongFavorite,
  songOriginOf,
  songVisibleTo,
  updateSong,
} from "./store/songs.ts";
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
