// index.ts — what a host's ENTRY imports: configure the fetch layer, provide the host, wrap its
// routes in RehearsalRecording so a take survives a page change, and the sections for its nav.
// The pages themselves are `./pages` and the settings section `./settings`, for a lazy chunk.

export { publicPageAt } from "./addresses";
export { configureRehearsal } from "./config";
export { type RehearsalHost, RehearsalHostProvider } from "./host";
export { followLocale } from "./i18n";
export { NewSessionButton } from "./recording/NewSessionButton";
export { RehearsalRecording } from "./recording/RehearsalRecording";
export { REHEARSAL_SECTIONS, rehearsalSectionAt } from "./sections";
