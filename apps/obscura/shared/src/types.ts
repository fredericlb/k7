// Types shared by obscura's frontends. Kept tiny on purpose: only put
// things here that more than one app actually consumes — local types belong
// in the app that owns them.

export interface SessionRow {
  id: number;
  name: string;
  // The caller's saved solo score for this session, when one exists. Set
  // server-side from the Scores Grist table for non-guest users; absent
  // means "never completed yet". The picker renders it as a small badge.
  score?: number;
  // Resume marker: present iff the user has an unfinished solo run on
  // this session. The picker shows a RESUME label and the played/total
  // ratio so the player knows where they left off without selecting first.
  resume?: {
    orderIndex: number;
    songIndex: number;
    score: number;
    played: number;
    total: number;
  };
}

// LoadProgress mirrors the backend's "session_loading" WS payload (and the
// solo-load HTTP polling shape) so SessionPicker can render the bar from
// either source without further translation.
export interface LoadProgress {
  id: number;
  done: number;
  total: number;
  name?: string;
}
