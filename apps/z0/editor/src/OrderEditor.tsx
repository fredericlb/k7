// OrderEditor.tsx — the running order of the evening: which category each round plays, which
// slice of it, and where the pauses fall. The one screen that edits session.yaml rather than a
// category file. See docs/editing.md.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { ChevronDown, ChevronUp, Pause, Plus, Trash2 } from "lucide-react";
import {
  addOrderCat,
  addOrderPause,
  moveOrderEntry,
  parseRange,
  removeOrderEntry,
  setOrderCat,
  setOrderPause,
  setOrderRange,
} from "./format";
import type { Store } from "./store";

/** A round's slice, checked against the category it names — the one error worth catching here. */
function rangeProblem(
  spec: string | undefined,
  count: number | undefined,
): string | null {
  if (!spec) return null;
  const r = parseRange(spec);
  if (!r) return "plage illisible";
  if (r.from < 1) return "commence avant le 1er";
  if (count !== undefined && r.from > count) return `au-delà de ${count}`;
  if (r.to !== null && r.to < r.from) return "fin avant le début";
  return null;
}

export function OrderEditor({
  store,
  onOpen,
}: {
  store: Store;
  onOpen: (slug: string, range?: string) => void;
}) {
  const session = store.session;
  if (!session) return null;
  const slugs = [...store.categories.keys()];
  const edit = (fn: Parameters<Store["editSession"]>[0]) =>
    store.editSession(fn);

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium">Les manches</h2>
        <span className="text-xs text-muted-foreground">
          {session.order.length} entrée(s)
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="text-xs"
            disabled={slugs.length === 0}
            onClick={() => edit((d) => addOrderCat(d, slugs[0]))}
          >
            <Plus className="mr-1 h-3 w-3" /> Manche
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-xs"
            onClick={() => edit((d) => addOrderPause(d))}
          >
            <Plus className="mr-1 h-3 w-3" /> Pause
          </Button>
        </div>
      </div>

      <ol className="flex flex-col gap-1">
        {session.order.map((e, i) => {
          const cat = e.cat ? store.categories.get(e.cat) : undefined;
          const problem =
            e.kind === "cat" ? rangeProblem(e.songs, cat?.songs.length) : null;
          return (
            <li
              key={i}
              className="flex items-center gap-2 rounded border px-2 py-1"
            >
              <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground">
                {i + 1}
              </span>

              {e.kind === "pause" ? (
                <>
                  <Pause className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <Input
                    className="h-7 flex-1 text-xs"
                    value={e.message ?? ""}
                    placeholder="Pause (sans message)"
                    onChange={(ev) =>
                      edit((d) => setOrderPause(d, i, ev.target.value))
                    }
                  />
                </>
              ) : (
                <>
                  {/* A plain select: a round naming a departed category stays VISIBLE rather than reset. */}
                  <select
                    className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-xs"
                    value={e.cat ?? ""}
                    onChange={(ev) =>
                      edit((d) => setOrderCat(d, i, ev.target.value))
                    }
                  >
                    {!cat && (
                      <option value={e.cat ?? ""}>
                        {e.cat ?? "(sans catégorie)"} — introuvable
                      </option>
                    )}
                    {slugs.map((s) => (
                      <option key={s} value={s}>
                        {store.categories.get(s)?.name ?? s}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="h-7 w-24 shrink-0 text-xs"
                    value={e.songs ?? ""}
                    placeholder="tout"
                    title="Plage 1-basée et inclusive : 1-5, 11-, 7"
                    onChange={(ev) =>
                      edit((d) => setOrderRange(d, i, ev.target.value))
                    }
                  />
                  {problem && (
                    <span className="shrink-0 text-[10px] text-destructive">
                      {problem}
                    </span>
                  )}
                  {cat && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 text-[10px]"
                      onClick={() => onOpen(cat.slug, e.songs)}
                    >
                      Ouvrir
                    </Button>
                  )}
                </>
              )}

              <div className="ml-auto flex shrink-0">
                <IconBtn
                  title="Monter"
                  disabled={i === 0}
                  onClick={() => edit((d) => moveOrderEntry(d, i, i - 1))}
                >
                  <ChevronUp className="h-3 w-3" />
                </IconBtn>
                <IconBtn
                  title="Descendre"
                  disabled={i === session.order.length - 1}
                  onClick={() => edit((d) => moveOrderEntry(d, i, i + 1))}
                >
                  <ChevronDown className="h-3 w-3" />
                </IconBtn>
                <IconBtn
                  title="Retirer cette entrée"
                  onClick={() => edit((d) => removeOrderEntry(d, i))}
                >
                  <Trash2 className="h-3 w-3" />
                </IconBtn>
              </div>
            </li>
          );
        })}
      </ol>

      {session.order.length === 0 && (
        <p className="py-2 text-xs text-muted-foreground">
          Aucune manche : la session ne jouerait rien.
        </p>
      )}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
