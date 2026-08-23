// Types shared by z0's frontends. Kept tiny on purpose: only put
// things here that more than one app actually consumes — local types belong
// in the app that owns them.

export interface SessionRow {
  id: number;
  name: string;
  // The caller's saved solo score; absent means never completed, and the picker badges it.
  score?: number;
  // Present only for an unfinished run, so the picker can label it without selecting first.
  resume?: {
    orderIndex: number;
    songIndex: number;
    score: number;
    played: number;
    total: number;
  };
}

// Mirrors the "session_loading" WS payload, so the bar draws from either source untranslated.
export interface LoadProgress {
  id: number;
  done: number;
  total: number;
  name?: string;
}
