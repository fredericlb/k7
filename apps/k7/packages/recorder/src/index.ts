// @k7/recorder — k7's microphone recording, live loudness detection
// and recorder/moment UI. The waveform canvas itself comes from the shared
// @studio/ui-waveform; importing this package brings in both stylesheets.
import "@studio/ui-waveform/styles.css";
import "./styles.css";

export { Waveform } from "@studio/ui-waveform";
export { type DetectOpts, type DetectResult, detectEvents } from "./detect";
export { downloadTake } from "./download";
export { LiveWaveform } from "./LiveWaveform";
export {
  MIC_ERRORS_EN,
  type MicErrorTexts,
  RECORDER_LABELS_EN,
  type RecorderLabels,
} from "./labels";
export { MomentPlayer } from "./MomentPlayer";
export { type PendingAnnotation, RecorderView } from "./RecorderView";
export { TagInput } from "./TagInput";
export {
  type BackedUpTake,
  forgetTake,
  listBackedUpTakes,
  readBackedUpTake,
} from "./takeBackup";
export type { Metronome, Selection } from "./types";
export { useMetronome } from "./useMetronome";
export {
  acquireMicrophone,
  describeMicError,
  type RecordingResult,
  type RecStatus,
  useRecorder,
} from "./useRecorder";
