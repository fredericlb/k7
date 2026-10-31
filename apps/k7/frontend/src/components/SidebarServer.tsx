// SidebarServer.tsx — the server picker, above the engine selector on the tray: whether the Libraries, Media and
// Rehearsal pages read this computer or the account's ACTIVE server, named `host · account`. The engine is not chosen here.
// See ../../docs/serverPicker.md.

import { Laptop, Server } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { m } from "../paraglide/messages.js";
import {
  type ServerChoice,
  setServerChoice,
  useServerChoice,
} from "../serverChoice";

/** `https://app.k7.rocks` → `app.k7.rocks`. */
const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

export function SidebarServer({
  server,
  account,
  folds = false,
}: {
  /** The active server, as an origin. */
  server: string;
  /** …and the account it is there: several may share a server, and the active one is the one read. */
  account?: string;
  /** On the sidebar's icon rail the block is one button that switches the server instead. */
  folds?: boolean;
}) {
  const choice = useServerChoice();
  const options: { value: ServerChoice; label: string; Icon: typeof Laptop }[] =
    [
      { value: "local", label: m["serverPick.local"](), Icon: Laptop },
      {
        value: "server",
        label: account ? `${hostOf(server)} · ${account}` : hostOf(server),
        Icon: Server,
      },
    ];
  const current = options.find((o) => o.value === choice) ?? options[0];
  return (
    <>
      {folds && (
        <button
          type="button"
          className="mx-auto mb-1 flex size-9 items-center justify-center rounded-md hover:bg-accent wide:hidden"
          title={m["serverPick.hint"]({ server: current.label })}
          aria-label={m["serverPick.section"]()}
          onClick={() =>
            setServerChoice(choice === "local" ? "server" : "local")
          }
        >
          <current.Icon className="h-4 w-4" />
        </button>
      )}
      <section
        aria-label={m["serverPick.section"]()}
        className={cn(
          "mx-2 mb-2 flex-col gap-1.5 rounded-md border border-border p-2 text-xs",
          folds ? "hidden wide:flex" : "flex",
        )}
      >
        <span className="text-muted-foreground">{m["serverPick.title"]()}</span>
        <div className="flex gap-1 rounded-md bg-secondary p-[3px]">
          {options.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={choice === value}
              title={m["serverPick.hint"]({ server: label })}
              onClick={() => setServerChoice(value)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1 transition-colors",
                choice === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground hover:bg-background/40",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
