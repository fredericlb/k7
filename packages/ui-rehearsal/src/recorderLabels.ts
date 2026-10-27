// recorderLabels.ts — @studio/recorder's words, filled from this app's catalogue. The package keeps
// English defaults and no catalogue of its own, so the language is decided here, per call.

import type { MicErrorTexts, RecorderLabels } from "@studio/recorder";
import { m } from "./paraglide/messages.js";

export const micErrors = (): MicErrorTexts => ({
  denied: m["mic.denied"](),
  notFound: m["mic.notFound"](),
  busy: m["mic.busy"](),
  insecure: m["mic.insecure"](),
  lost: m["mic.lost"](),
});

export const recorderLabels = (): RecorderLabels => ({
  recorder: m["recorder.region"](),
  paused: m["recorder.paused"](),
  rec: m["recorder.rec"](),
  tempo: m["recorder.tempo"](),
  more: m["recorder.more"](),
  metronomeStart: m["recorder.metronomeStart"](),
  metronomeStop: m["recorder.metronomeStop"](),
  metronomeOn: (bpm) => m["recorder.metronomeOn"]({ bpm }),
  uploadFailed: (message) => m["recorder.uploadFailed"]({ message }),
  retryUpload: m["recorder.retryUpload"](),
  downloadTake: m["recorder.downloadTake"](),
  starting: m["recorder.starting"](),
  start: m["recorder.start"](),
  cancel: m["common.cancel"](),
  highlights: m["recorder.highlights"](),
  keepPlaying: m["recorder.keepPlaying"](),
  taggedBadge: m["recorder.taggedBadge"](),
  listenAndTag: m["recorder.listenAndTag"](),
  reviewing: (from, to) => m["recorder.reviewing"]({ from, to }),
  play: m["common.play"](),
  pause: m["common.pause"](),
  whatHappened: m["recorder.whatHappened"](),
  add: m["common.add"](),
  resume: m["recorder.resume"](),
  holdTitle: m["recorder.holdTitle"](),
  holding: m["recorder.holding"](),
  stopSave: m["recorder.stopSave"](),
  uploading: m["recorder.uploading"](),
  uploadProgress: (percent) =>
    m["common.uploadProgress"]({ percent: String(percent) }),
  analyzing: m["common.analyzing"](),
  removeTag: (tag) => m["recorder.removeTag"]({ tag }),
  mic: micErrors(),
});
