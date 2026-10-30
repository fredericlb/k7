// host.tsx — what the app mounting the media library hands its COMPONENTS: the labels, the route
// prefix it is mounted under, and who is signed in. The fetch layer's own settings are config.ts,
// which a context cannot reach. See ../docs/host.md.

import { createContext, type ReactNode, useContext } from "react";
import type { LibraryLabels } from "./labels";

export interface LibraryHost {
  labels: LibraryLabels;
  /** The path the screens live under, e.g. "/media" — "" at the router's root. */
  prefix: string;
  /** Who is signed in: an engine session is per service AND per person. */
  user: string;
  /** The host's own engine selector, when it has one: the engine "The engine" plays on, and where it is heard. */
  engine?: HostEngine;
  /** Where a capture opens, to cut moments from it; absent, a capture's row opens nothing — ../docs/recordings.md. */
  recordingHref?: (path: string) => string;
  /** Where a moment opens; absent, a moment's row opens nothing. */
  momentHref?: (id: string) => string;
  /** What starts a take, offered with the captures; absent, they can only be added as files. */
  recordButton?: ReactNode;
  /** How the host draws a song's lyrics, tablature or sheets; absent, a song shows its tags alone — ../docs/songPlayer.md. */
  songAttachment?: (props: SongAttachmentView) => ReactNode;
}

/** One of a song's attachments, as the song screen hands it to the host to draw. */
export interface SongAttachmentView {
  /** `chords` is lyrics with chords, typed by hand; `diagrams` draws the fingering of each of `chords`. */
  kind: "lyrics" | "chords" | "tablature" | "sheet" | "diagrams";
  text: string;
  sheets: { id: string; name: string; mime: string }[];
  sheetUrl: (id: string) => string;
  /** Remove one sheet; absent, the sheets are drawn read-only. */
  onDeleteSheet?: (id: string) => Promise<void>;
  /** Semitones the chords are shown shifted by — the lyrics', the chords' and a score's. */
  transpose?: number;
  /** The timed line being sung, by line index of `text`, highlighted and kept in view. */
  activeLine?: number | null;
  /** A timed line tapped, with its time in seconds; absent, timed lines are not controls. */
  onLineClick?: (seconds: number) => void;
  /** For `diagrams`: the chord symbols to draw, already transposed. */
  chords?: string[];
}

/** What a host's engine selector decided — ../docs/playbackTarget.md, "The third: the moteur". */
export interface HostEngine {
  /** The engine chosen; null leaves the choice to the account's remembered one and the policy. */
  id: string | null;
  /** This browser hears the engine here, through its broadcast, rather than only on its outputs. */
  listenHere: boolean;
}

const HostContext = createContext<LibraryHost | null>(null);

export function LibraryHostProvider({
  value,
  children,
}: {
  value: LibraryHost;
  children: ReactNode;
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useLibraryHost(): LibraryHost {
  const h = useContext(HostContext);
  if (!h) throw new Error("useLibraryHost outside LibraryHostProvider");
  return h;
}

/** The labels alone, which is what nearly every component wants. */
export const useLabels = (): LibraryLabels => useLibraryHost().labels;
