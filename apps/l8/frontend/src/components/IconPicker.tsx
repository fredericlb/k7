// IconPicker.tsx — pick a lucide icon by name. The whole set (~1500), searched, in a popover.
//
// lucide-react is already this app's icon library, so nothing new is imported into the project to
// get here. What IS new is importing it as a NAMESPACE: everywhere else picks its icons by name and
// is tree-shaken down to those, while a picker has to know all of them. That costs the bundle the
// full set, which is why this file is only ever reached through React.lazy — the settings page pays
// it when it opens, and nobody else pays it at all.

import { Input } from "@frediverse/ui/input";
import * as lucide from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";

type IconComponent = ComponentType<{ className?: string }>;

/** Every exported icon, by name. Filtered to real components: the module also exports helpers,
 *  the `icons` map and a few aliases, and a picker offering `createLucideIcon` would be absurd. */
function allIcons(): [string, IconComponent][] {
  return Object.entries(lucide as Record<string, unknown>)
    .filter(
      ([name, v]) =>
        /^[A-Z]/.test(name) &&
        !name.endsWith("Icon") && // the aliased duplicates of every name
        (typeof v === "function" || typeof v === "object"),
    )
    .map(([name, v]) => [name, v as IconComponent]);
}

/** One icon by name, or null — what a menu row draws beside a command. Exported because the
 *  settings list and any menu consuming the prefs need the same lookup. */
export function iconByName(name: string | undefined): IconComponent | null {
  if (!name) return null;
  const v = (lucide as Record<string, unknown>)[name];
  return typeof v === "function" || (v && typeof v === "object")
    ? (v as IconComponent)
    : null;
}

export default function IconPicker({
  value,
  onPick,
}: {
  value?: string;
  onPick: (name: string | undefined) => void;
}) {
  const [q, setQ] = useState("");
  const icons = useMemo(allIcons, []);
  const needle = q.trim().toLowerCase();
  // Capped: two hundred rows is already more than anyone scans, and rendering fifteen hundred
  // SVGs into a popover is a visible pause on every keystroke.
  const shown = useMemo(
    () =>
      (needle
        ? icons.filter(([n]) => n.toLowerCase().includes(needle))
        : icons
      ).slice(0, 200),
    [icons, needle],
  );

  return (
    <div className="w-72">
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="chercher une icône…"
        className="mb-2 h-7 text-xs"
      />
      <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
        {/* "none" first, so taking an icon back is as easy as choosing one. */}
        <button
          type="button"
          title="aucune"
          onClick={() => onPick(undefined)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
        >
          —
        </button>
        {shown.map(([name, Icon]) => (
          <button
            type="button"
            key={name}
            title={name}
            onClick={() => onPick(name)}
            className={
              name === value
                ? "flex h-7 w-7 items-center justify-center rounded bg-secondary"
                : "flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
            }
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">
          aucune icône de ce nom
        </p>
      )}
    </div>
  );
}
