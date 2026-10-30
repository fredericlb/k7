// index.ts — the media library as a host mounts it: configure the fetch layer, provide the host,
// wrap the playable pages in MediaPlayback, and draw MediaLibrary with the sections in the nav.
// See ../docs/host.md.

export { configureLibrary, type LibraryConfig } from "./config";
export {
  type HostEngine,
  type LibraryHost,
  LibraryHostProvider,
  type SongAttachmentView,
  useLibraryHost,
} from "./host";
export type { LibraryLabels } from "./labels";
export { MediaLibrary } from "./MediaLibrary";
export { MediaPlayback } from "./MediaPlayback";
export { QueueButton } from "./playback/QueueButton";
export { SECTION_IDS, type SectionId } from "./routes";
export {
  LIBRARY_SECTIONS,
  type LibrarySection,
  sectionAt,
  sectionLabel,
  sectionPath,
} from "./sections";
