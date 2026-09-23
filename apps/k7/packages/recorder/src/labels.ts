// labels.ts — every word the recorder's screens show, as one object the host app fills in its own
// language. The package carries no catalogue of its own: English is the default a host can override.

/** What a failed microphone is called, by what went wrong. */
export interface MicErrorTexts {
  denied: string;
  notFound: string;
  busy: string;
  insecure: string;
}

export const MIC_ERRORS_EN: MicErrorTexts = {
  denied:
    "Microphone permission was denied. Allow it in your browser's site settings and try again.",
  notFound:
    "No microphone was found. Check that an input device is connected and not in use by another app.",
  busy: "The microphone is busy or unavailable — another app may be using it.",
  insecure:
    "Microphone access needs a secure context (https:// or http://localhost).",
};

export interface RecorderLabels {
  returnToRecording: string;
  paused: string;
  rec: string;
  detectedSoFar: string;
  moments: (n: number) => string;
  tagged: (n: number) => string;
  open: string;
  tempo: string;
  metronomeStart: string;
  metronomeStop: string;
  metronomeOn: (bpm: number) => string;
  uploadFailed: (message: string) => string;
  starting: string;
  intro: string;
  start: string;
  cancel: string;
  autoGain: (gain: string) => string;
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
  orHoldSpace: string;
  tagsPending: (n: number) => string;
  uploading: string;
  removeTag: (tag: string) => string;
  mic: MicErrorTexts;
}

const plural = (n: number, one: string, other: string) =>
  `${n} ${n === 1 ? one : other}`;

export const RECORDER_LABELS_EN: RecorderLabels = {
  returnToRecording: "Return to recording",
  paused: "paused",
  rec: "rec",
  detectedSoFar: "Detected moments so far",
  moments: (n) => plural(n, "moment", "moments"),
  tagged: (n) => `${n} tagged`,
  open: "Open",
  tempo: "Metronome tempo (BPM)",
  metronomeStart: "Start the metronome",
  metronomeStop: "Stop the metronome",
  metronomeOn: (bpm) => `Metronome on at ${bpm} BPM — click to stop`,
  uploadFailed: (message) => `Upload failed: ${message}`,
  starting: "Starting recording… allow microphone access if prompted.",
  intro:
    "Everything except silences (2s+ below the floor) is flagged live as a highlight — click one to pause, listen back, and tag it, then resume.",
  start: "Start recording",
  cancel: "Cancel",
  autoGain: (gain) => `auto gain ${gain}× — leveled to just below saturation`,
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
  holdTitle: "Hold 2s to stop & save (or hold Space)",
  holding: "Hold to stop…",
  stopSave: "Stop & save",
  orHoldSpace: "or hold space",
  tagsPending: (n) => `${plural(n, "tag", "tags")} pending`,
  uploading: "Uploading & analyzing…",
  removeTag: (tag) => `Remove ${tag}`,
  mic: MIC_ERRORS_EN,
};
