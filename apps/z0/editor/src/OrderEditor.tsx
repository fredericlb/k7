// OrderEditor.tsx — the running order of the evening: which category each round plays, which
// slice of it, and where the pauses fall. The one screen that edits session.yaml rather than a
// category file. See docs/editing.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Plus,
  Trash2,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { RowAction, Tip } from "./controls";
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

/** The item value of a round that names no category: Radix refuses "" as an item value. */
const NONE = "__none__";

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
            disabled={slugs.length === 0}
            onClick={() => edit((d) => addOrderCat(d, slugs[0]))}
          >
            <Plus className="size-3.5" /> Manche
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => edit((d) => addOrderPause(d))}
          >
            <Plus className="size-3.5" /> Pause
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
              className="flex items-center gap-2 rounded-md border bg-card px-2 py-1"
            >
              <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground">
                {i + 1}
              </span>

              {e.kind === "pause" ? (
                <>
                  <Pause className="size-3 shrink-0 text-muted-foreground" />
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={e.message ?? ""}
                    placeholder="Pause (sans message)"
                    onChange={(ev) =>
                      edit((d) => setOrderPause(d, i, ev.target.value))
                    }
                  />
                </>
              ) : (
                <>
                  {/* A round naming a departed category keeps an item of its own, so it stays VISIBLE rather than reset. */}
                  <Select
                    value={e.cat || NONE}
                    onValueChange={(v) =>
                      edit((d) => setOrderCat(d, i, v === NONE ? "" : v))
                    }
                  >
                    <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!cat && (
                        <SelectItem value={e.cat || NONE}>
                          {e.cat || "(sans catégorie)"} — introuvable
                        </SelectItem>
                      )}
                      {slugs.map((s) => (
                        <SelectItem key={s} value={s}>
                          {store.categories.get(s)?.name ?? s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Tip label="Plage 1-basée et inclusive : 1-5, 11-, 7">
                    <Input
                      className="h-8 w-24 flex-none text-xs"
                      value={e.songs ?? ""}
                      placeholder="tout"
                      onChange={(ev) =>
                        edit((d) => setOrderRange(d, i, ev.target.value))
                      }
                    />
                  </Tip>
                  {problem && <Badge variant="rec">{problem}</Badge>}
                  {cat && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => onOpen(cat.slug, e.songs)}
                    >
                      Ouvrir
                    </Button>
                  )}
                </>
              )}

              <div className="ml-auto flex shrink-0">
                <RowAction
                  title="Monter"
                  disabled={i === 0}
                  onClick={() => edit((d) => moveOrderEntry(d, i, i - 1))}
                >
                  <ChevronUp />
                </RowAction>
                <RowAction
                  title="Descendre"
                  disabled={i === session.order.length - 1}
                  onClick={() => edit((d) => moveOrderEntry(d, i, i + 1))}
                >
                  <ChevronDown />
                </RowAction>
                <RowAction
                  title="Retirer cette entrée"
                  onClick={() => edit((d) => removeOrderEntry(d, i))}
                >
                  <Trash2 />
                </RowAction>
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
