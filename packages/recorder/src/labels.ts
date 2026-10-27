// labels.ts — every word the recorder's screens show, as one object the host app fills in its own
// language. The package carries no catalogue of its own: English is the default a host can override.

/** What a failed microphone is called, by what went wrong. */
export interface MicErrorTexts {
  denied: string;
  notFound: string;
  busy: string;
  insecure: string;
  lost: string;
}

export const MIC_ERRORS_EN: MicErrorTexts = {
  denied:
    "Microphone permission was denied. Allow it in your browser's site settings and try again.",
  notFound:
    "No microphone was found. Check that an input device is connected and not in use by another app.",
  busy: "The microphone is busy or unavailable — another app may be using it.",
  insecure:
    "Microphone access needs a secure context (https:// or http://localhost).",
  lost: "The input went away mid-take — the recording is paused, and what came before is kept.",
};

export interface RecorderLabels {
  /** The bar's name for assistive technology: the recorder is a region of the page, not a dialog. */
  recorder: string;
  paused: string;
  rec: string;
  tempo: string;
  more: string;
  metronomeStart: string;
  metronomeStop: string;
  metronomeOn: (bpm: number) => string;
  uploadFailed: (message: string) => string;
  retryUpload: string;
  downloadTake: string;
  starting: string;
  start: string;
  cancel: string;
  highlights: string;
  keepPlaying: string;
  taggedBadge: string;
  listenAndTag: string;
  reviewing: (from: string, to: string) => string;
  play: string;
  pause: string;
  whatHappened: string;
  add: string;
  resume: string;
  holdTitle: string;
  holding: string;
  stopSave: string;
  uploading: string;
  /** The share of the take sent so far, 0 to 100. */
  uploadProgress: (percent: number) => string;
  /** Every byte sent, the server still measuring the take. */
  analyzing: string;
  removeTag: (tag: string) => string;
  mic: MicErrorTexts;
}

export const RECORDER_LABELS_EN: RecorderLabels = {
  recorder: "Recorder",
  paused: "paused",
  rec: "rec",
  tempo: "Metronome tempo (BPM)",
  more: "More",
  metronomeStart: "Start the metronome",
  metronomeStop: "Stop the metronome",
  metronomeOn: (bpm) => `Metronome on at ${bpm} BPM — click to stop`,
  uploadFailed: (message) => `Upload failed: ${message}`,
  retryUpload: "Retry upload",
  downloadTake: "Download the take",
  starting: "Starting recording… allow microphone access if prompted.",
  start: "Start recording",
  cancel: "Cancel",
  highlights: "Highlights",
  keepPlaying: "Keep playing — everything between 2s+ silences shows up here.",
  taggedBadge: "tagged",
  listenAndTag: "listen & tag",
  reviewing: (from, to) => `Reviewing ${from} – ${to}`,
  play: "Play",
  pause: "Pause",
  whatHappened: "What happened here?",
  add: "Add",
  resume: "Resume recording",
  holdTitle: "Hold 2s to stop & save",
  holding: "Hold to stop…",
  stopSave: "Stop & save",
  uploading: "Uploading & analyzing…",
  uploadProgress: (percent) => `Uploading… ${percent}%`,
  analyzing: "Analyzing…",
  removeTag: (tag) => `Remove ${tag}`,
  mic: MIC_ERRORS_EN,
};
