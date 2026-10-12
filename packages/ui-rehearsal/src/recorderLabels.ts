// recorderLabels.ts — @studio/recorder's words, filled from this app's catalogue. The package keeps
// English defaults and no catalogue of its own, so the language is decided here, per call.

import type { MicErrorTexts, RecorderLabels } from "@studio/recorder";
import { isOne } from "./i18n";
import { m } from "./paraglide/messages.js";

export const micErrors = (): MicErrorTexts => ({
  denied: m["mic.denied"](),
  notFound: m["mic.notFound"](),
  busy: m["mic.busy"](),
  insecure: m["mic.insecure"](),
  lost: m["mic.lost"](),
});

export const recorderLabels = (): RecorderLabels => ({
  returnToRecording: m["recorder.returnToRecording"](),
  paused: m["recorder.paused"](),
  rec: m["recorder.rec"](),
  detectedSoFar: m["recorder.detectedSoFar"](),
  moments: (n) =>
    isOne(n)
      ? m["recorder.moments.one"]({ n })
      : m["recorder.moments.other"]({ n }),
  tagged: (n) => m["recorder.tagged"]({ n }),
  open: m["common.open"](),
  tempo: m["recorder.tempo"](),
  metronomeStart: m["recorder.metronomeStart"](),
  metronomeStop: m["recorder.metronomeStop"](),
  metronomeOn: (bpm) => m["recorder.metronomeOn"]({ bpm }),
  uploadFailed: (message) => m["recorder.uploadFailed"]({ message }),
  retryUpload: m["recorder.retryUpload"](),
  downloadTake: m["recorder.downloadTake"](),
  starting: m["recorder.starting"](),
  intro: m["recorder.intro"](),
  start: m["recorder.start"](),
  cancel: m["common.cancel"](),
  autoGain: (gain) => m["recorder.autoGain"]({ gain }),
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
  orHoldSpace: m["recorder.orHoldSpace"](),
  tagsPending: (n) =>
    isOne(n)
      ? m["recorder.tagsPending.one"]({ n })
      : m["recorder.tagsPending.other"]({ n }),
  uploading: m["recorder.uploading"](),
  removeTag: (tag) => m["recorder.removeTag"]({ tag }),
  mic: micErrors(),
});
