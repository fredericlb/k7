// statusLine.ts — the shell's status line as a tiny external store, read by its one leaf
// (components/StatusText.tsx). Not App state: a drag re-states the line on every snapped cell,
// and each new text would otherwise re-render the whole shell (docs/audit.md).

/** What the line shows: the app's last word, whether it was a refusal, and a menu hint borrowing the line. */
export interface StatusLineState {
  text: string;
  refused: boolean;
  hint: string;
}

export interface StatusLineStore {
  get: () => StatusLineState;
  subscribe: (fn: () => void) => () => void;
  /** The app's own word; `refused` only from `runCommand`. */
  say: (text: string, refused: boolean) => void;
  /** What the menu entry under the pointer does, "" when the menu closes. */
  hint: (text: string) => void;
}

export function createStatusLine(): StatusLineStore {
  let state: StatusLineState = { text: "", refused: false, hint: "" };
  const subs = new Set<() => void>();
  const set = (next: StatusLineState) => {
    state = next;
    for (const fn of subs) fn();
  };
  return {
    get: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    say: (text, refused) => {
      if (state.text === text && state.refused === refused) return;
      set({ ...state, text, refused });
    },
    hint: (text) => {
      if (state.hint === text) return;
      set({ ...state, hint: text });
    },
  };
}
