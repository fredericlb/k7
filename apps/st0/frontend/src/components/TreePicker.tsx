// TreePicker.tsx — the browsing popup: levels that open sideways on hover, a search field
// at the root, keyboard navigation, and the same dismissal contract as ContextMenu.
//
// Generic over what a leaf CARRIES, because two things browse this way and behaving
// differently would be a coin toss for the user: the `+` on a graph arrow picking a module
// (ModulePicker), and a module widget picking a file from the asset library
// (AssetPicker). Both are "a nested catalogue, searchable" — the only difference is what
// the tree is built from and what a pick hands back.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One row: a branch has `children`, a leaf has `entry`, and a row with neither is plain text — which is why both are optional. */
export interface TreeNode<T> {
  key: string;
  label: string;
  children?: TreeNode<T>[];
  entry?: T;
  /** Shown muted on the right of a leaf — the full ref/path, so you see what you pick. */
  hint?: string;
}

const MENU_BASE =
  "min-w-[13rem] rounded-md border border-border bg-popover py-1 text-sm shadow-md";
// Scrolling and submenus can't share an element — an `overflow` clips a submenu away. They never need to.
const MENU_SCROLL = "max-h-[min(28rem,80vh)] overflow-y-auto overflow-x-hidden";

/** One level: its rows, and the next level beside whichever is open; `header` sits outside the scroll area so it stays put. */
function Level<T>({
  nodes,
  onPick,
  header,
  selected,
  onHover,
}: {
  nodes: TreeNode<T>[];
  onPick: (e: T) => void;
  header?: React.ReactNode;
  selected?: string | null;
  onHover?: (key: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const subRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  // Keep the keyboard's row in view as ↑/↓ walk a list longer than the popup.
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Flip a submenu left when it would run off the edge, MEASURED: levels differ wildly in width.
  useLayoutEffect(() => {
    const el = subRef.current;
    if (!el) {
      setFlip(false);
      return;
    }
    setFlip(el.getBoundingClientRect().right > window.innerWidth - 8);
  }, [open]);

  // Only the all-leaf levels scroll — see MENU_SCROLL.
  const hasBranches = nodes.some((n) => n.children?.length);

  return (
    <div className={MENU_BASE} role="menu">
      {header}
      <div className={hasBranches ? "" : MENU_SCROLL}>
        {nodes.map((n) => {
          const isLeaf = !n.children?.length;
          return (
            <div key={n.key} className="relative">
              <button
                type="button"
                role="menuitem"
                ref={n.key === selected ? selRef : undefined}
                // Hover opens a branch, click picks a leaf; a branch isn't clickable, there being nothing to pick.
                onMouseEnter={() => {
                  setOpen(isLeaf ? null : n.key);
                  onHover?.(n.key); // keep the keyboard's row under the mouse
                }}
                onFocus={() => setOpen(isLeaf ? null : n.key)}
                onClick={() => n.entry && onPick(n.entry)}
                className={`flex w-full items-center justify-between gap-4 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground ${
                  n.key === selected ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <span
                  className={`truncate font-mono ${n.entry || n.children ? "" : "text-muted-foreground"}`}
                >
                  {n.label}
                </span>
                {isLeaf ? (
                  n.hint ? (
                    <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
                      {n.hint}
                    </span>
                  ) : null
                ) : (
                  <span className="shrink-0 text-muted-foreground">›</span>
                )}
              </button>
              {open === n.key && n.children?.length ? (
                <div
                  ref={subRef}
                  className="absolute top-0 z-10"
                  style={flip ? { right: "100%" } : { left: "100%" }}
                >
                  <Level nodes={n.children} onPick={onPick} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TreePicker<T>({
  x,
  y,
  tree,
  search: runSearch,
  searchLimit,
  placeholder,
  emptyLabel,
  onPick,
  onClose,
}: {
  x: number; // viewport coords of whatever opened it
  y: number;
  /** The catalogue, already levelled. An empty tree renders nothing at all. */
  tree: TreeNode<T>[];
  /** Flat matches for a query — the caller owns ranking, since only it knows the shape. */
  search: (query: string) => TreeNode<T>[];
  /** The cap `search` applies, so this can say the list was cut rather than look complete. */
  searchLimit: number;
  placeholder: string;
  emptyLabel: string;
  onPick: (pick: T) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = runSearch(query);
  const searching = query.trim().length > 0;
  const selIdx = results.length
    ? ((sel % results.length) + results.length) % results.length
    : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  // The same dismissal contract as ContextMenu, deliberately: two popups that dismissed differently is a coin toss.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Escape backs out a step at a time: it clears a search before closing, so a typo doesn't cost you the popup.
        if (searchRef.current?.value) {
          setQuery("");
          setSel(0);
        } else onClose();
      }
    };
    // A scroll under the picker moves its `+`, so it closes — but its own lists are exempt (scroll doesn't bubble).
    const scrolled = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [onClose]);

  // The search field takes the keys at once: typing a name is the fastest way in, and nothing else wants them.
  useEffect(() => {
    // preventScroll: focusing can scroll an ancestor, and a scroll is what dismisses this popup.
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  // Nothing to offer: an empty popup would just be a grey box you have to dismiss.
  if (!tree.length) return null;

  const pick = (e: T) => {
    onPick(e);
    onClose();
  };

  const search = (
    <div className="border-b border-border px-2 pb-1">
      <input
        ref={searchRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (!searching) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSel((i) => i + (e.key === "ArrowDown" ? 1 : -1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const hit = results[selIdx]?.entry;
            if (hit) pick(hit);
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full bg-transparent px-1 py-1 font-mono text-sm outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );

  return (
    <div ref={ref} style={{ left: pos.x, top: pos.y }} className="fixed z-50">
      {searching ? (
        <Level
          nodes={
            results.length
              ? // A row with neither entry nor children renders as plain text: here, the
                // note that the list was cut, so a query that matches half the catalogue doesn't silently look like it matched 40.
                results.length === searchLimit
                ? [
                    ...results,
                    { key: "more", label: `first ${searchLimit} matches` },
                  ]
                : results
              : // Same trick: a query that matches nothing says so rather than leaving
                // the popup blank.
                [{ key: "none", label: emptyLabel }]
          }
          onPick={pick}
          header={search}
          selected={results.length ? results[selIdx].key : null}
          onHover={(key) => {
            const i = results.findIndex((r) => r.key === key);
            if (i >= 0) setSel(i);
          }}
        />
      ) : (
        <Level nodes={tree} onPick={pick} header={search} />
      )}
    </div>
  );
}
