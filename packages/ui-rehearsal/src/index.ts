// index.ts — what a host's ENTRY imports: configure the fetch layer, provide the host, wrap its
// routes in RehearsalRecording so a take survives a page change, and the sections for its nav.
// The pages themselves are `./pages` and the settings section `./settings`, for a lazy chunk.

export { isRemoteMic, publicPageAt } from "./addresses";
export { configureRehearsal, type RehearsalConfig } from "./config";
export {
  type RehearsalHost,
  RehearsalHostProvider,
  useRehearsalHost,
  useRehearsalNav,
} from "./host";
export { followLocale } from "./i18n";
export { useRehearsalRecording } from "./recording/context";
export { NewSessionButton } from "./recording/NewSessionButton";
export { RehearsalRecording } from "./recording/RehearsalRecording";
export {
  isSongPage,
  REHEARSAL_SECTIONS,
  type RehearsalSection,
  rehearsalSectionAt,
} from "./sections";
