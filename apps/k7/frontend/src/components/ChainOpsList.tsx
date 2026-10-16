// ChainOpsList.tsx — the body of a clip's "operations" menu: a search over every chain the project
// and the library offer, and the list to run one from. The clip panel and the editor's toolbar draw
// the same menu over the same clip (../clipOps.ts spells the command).

import { m } from "../paraglide/messages.js";

export function ChainOpsList({
  search,
  onSearch,
  ops,
  pending = false,
  onPick,
}: {
  search: string;
  onSearch: (q: string) => void;
  ops: string[];
  /** The chains are still being listed: an ellipsis rather than "none". */
  pending?: boolean;
  onPick: (chain: string) => void;
}) {
  return (
    <>
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={m["clip.searchChain"]()}
        // Not autofocused: the menu takes the focus itself, and stealing it back breaks the arrow keys.
        className="mb-1 w-full rounded border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
      />
      <div className="max-h-64 overflow-auto">
        {ops.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {pending ? "…" : m["clip.noChain"]()}
          </p>
        ) : (
          ops.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
            >
              {c}
            </button>
          ))
        )}
      </div>
    </>
  );
}
