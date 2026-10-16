// ProjectSettingsTab.tsx — the settings panel's PROJECT tab: what the open song says about its
// whole mix, today its summing console. Every change is the `project …` verb, so the palette and
// this tab write the same line. See packages/song/docs/console.md.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";

/** What the file service said: the systems the libraries hold, and the one the project names. */
interface Consoles {
  systems: { ref: string; label: string }[];
  current?: string;
}

export function ProjectSettingsTab({
  onRun,
}: {
  onRun: (line: string) => Promise<void>;
}) {
  // Null while asking, and left null when there is no project to ask about.
  const [consoles, setConsoles] = useState<Consoles | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    () =>
      api.consoles().then(
        (c) => {
          setConsoles(c);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (value: string) => {
    await onRun(`project console ${value || "none"}`);
    // Read back rather than assumed: a refused verb leaves the file as it was.
    await load();
  };

  if (failed)
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {m["settings.noProject"]()}
      </p>
    );

  const current = consoles?.current ?? "";
  // A system the file names but no library holds is kept in the list, so the select shows the truth.
  const missing = current && !consoles?.systems.some((s) => s.ref === current);

  return (
    <div className="h-full overflow-y-auto p-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{m["settings.console"]()}</span>
        <select
          value={current}
          disabled={!consoles}
          onChange={(e) => void pick(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="">{m["settings.consoleNone"]()}</option>
          {consoles?.systems.map((s) => (
            <option key={s.ref} value={s.ref} title={s.ref}>
              {s.label}
            </option>
          ))}
          {missing && <option value={current}>{current} ?</option>}
        </select>
        <span className="text-xs text-muted-foreground">
          {consoles && !consoles.systems.length
            ? m["settings.consoleEmpty"]()
            : m["settings.consoleHint"]()}
        </span>
      </label>
    </div>
  );
}
