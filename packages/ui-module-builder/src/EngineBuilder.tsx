// EngineBuilder.tsx — the module builder for a module with ENGINES: a strip of them above the
// screen, and the screen re-mounted on the one picked, since each engine is a module folder with
// its own panel, widgets and presets. "module" edits the module's own file, which names the
// default. A module without engines gets the plain screen. See packages/song/docs/engines.md.

import { cn } from "@frediverse/ui/lib/utils";
import { type ComponentProps, useCallback, useEffect, useState } from "react";
import { ModuleScreen } from "./ModuleBuilder";

export * from "./ModuleBuilder";

type Props = ComponentProps<typeof ModuleScreen>;

/** What the store said: the engines beside the module, and the one it runs. */
interface Engines {
  engines: string[];
  engine?: string;
}

export function ModuleBuilder(props: Props) {
  const { store, path, onSaved } = props;
  // Read loosely: a builder that reports no dirtiness simply never holds the strip back.
  const { onDirtyChange } = props as {
    onDirtyChange?: (dirty: boolean) => void;
  };
  // Null while asking: the screen mounts once, on the right file, rather than twice.
  const [list, setList] = useState<Engines | null>(
    store.engines ? null : { engines: [] },
  );
  // The engine being edited, or null for the module's own file.
  const [on, setOn] = useState<string | null>(null);
  // A switch remounts the screen, so it waits until what is on screen is saved.
  const [dirty, setDirty] = useState(false);

  const ask = useCallback(
    (keep: boolean) =>
      store.engines?.(path).then(
        (r) => {
          setList(r);
          if (!keep)
            setOn(r.engines.length ? (r.engine ?? r.engines[0]) : null);
        },
        () => setList({ engines: [] }), // no answer is no engines: the plain screen still works
      ),
    [store, path],
  );
  useEffect(() => {
    void ask(false);
  }, [ask]);

  if (!list) return null;
  if (!list.engines.length) return <ModuleScreen {...props} />;

  const dir = path.slice(0, path.lastIndexOf("/"));
  const target = on ? `${dir}/engines/${on}/module.yaml` : path;
  const tab = (id: string | null, label: string, title: string) => (
    <button
      key={id ?? ""}
      type="button"
      disabled={dirty && on !== id}
      onClick={() => setOn(id)}
      title={
        dirty && on !== id
          ? "save first — the other engine opens on its own files"
          : title
      }
      className={cn(
        "rounded px-2 py-0.5 text-xs",
        on === id
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground",
        dirty && on !== id && "opacity-50",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-1 text-[11px] text-muted-foreground">engine</span>
        {list.engines.map((e) =>
          tab(
            e,
            e === list.engine ? `${e} •` : e,
            e === list.engine
              ? `${e} — the default: what a node runs until it picks another`
              : `${e} — its own panel, widgets and presets`,
          ),
        )}
        <span className="mx-1 h-3 w-px bg-border" />
        {tab(
          null,
          "module",
          "the module's own file — its label, and which engine is the default",
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ModuleScreen
          {...props}
          // One mount per file: an engine opens on its own state, not on the last one's.
          key={target}
          path={target}
          // The module's own file holds no panel worth opening on, so it opens on its text.
          initialPane={on ? props.initialPane : "module"}
          {...({
            onDirtyChange: (d: boolean) => {
              setDirty(d);
              onDirtyChange?.(d);
            },
          } as unknown as Partial<Props>)}
          onSaved={() => {
            onSaved();
            // The module's file names the default, so a save there may have moved it.
            if (!on) void ask(true);
          }}
        />
      </div>
    </div>
  );
}
