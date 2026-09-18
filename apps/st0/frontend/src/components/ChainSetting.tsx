// ChainSetting.tsx — WHICH CHAIN this machine answers a standing question with, asked once. A section
// of the I/O tab, because it is the same kind of fact as the interface above it: something about this
// MACHINE that every project then works against.
//
// It is here rather than on the screens that use it — the playlist panel's « Séparer les stems », a
// desk catching up on an unprepared record, k7's « Make instrumental » — and that placement is the
// feature. Which module separates and which model it wants does not vary by set list, so a picker
// beside the button asked the same question of the same person every time. One component for the two
// questions, since only the words and the verb differ. See ../docs/playlists.md.

import { MEDIATEK_REF } from "@studio/song-schema/songRef";
import type { WebPreferences } from "@studio/web-protocol";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "../api";

export function ChainSetting({
  icon: Icon,
  title,
  label,
  none,
  body,
  noChains,
  verb,
  pick,
  onRun,
}: {
  icon: LucideIcon;
  title: string;
  label: string;
  /** What the empty option reads as — "this machine does not do that at all", which is a real state. */
  none: string;
  body: string;
  noChains: ReactNode;
  /** The verb that WRITES the preference, so this control and the command bar are one road. */
  verb: string;
  pick: (p: WebPreferences) => string | null;
  onRun: (line: string) => Promise<void>;
}) {
  /** What the machine remembers: a ref, `null` for "never told", `undefined` while reading. */
  const [chain, setChain] = useState<string | null | undefined>(undefined);
  /** The library's chains, as `@st0/…` refs — empty for an account with no library repository, which the select says out loud. */
  const [chains, setChains] = useState<string[]>([]);
  const [error, setError] = useState("");

  const read = useCallback(() => {
    void api
      .preferences()
      .then((p) => setChain(pick(p)))
      .catch((e: Error) => {
        setChain(null);
        setError(e.message);
      });
  }, [pick]);
  useEffect(read, [read]);
  useEffect(() => {
    void api
      .libraryChains()
      .then((r) => setChains(r.chains.map((c) => `${MEDIATEK_REF}/${c.ref}`)))
      .catch(() => setChains([]));
  }, []);

  /** Set it, then RE-READ it: the command can refuse, so a refused pick snaps back to what is actually stored. */
  const choose = async (ref: string) => {
    setError("");
    // `""` is how a verb is told to clear it, quotes and all: an empty argument asks for its usage instead.
    await onRun(`${verb} ${ref || '""'}`);
    read();
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="flex flex-col gap-1.5 px-2">
        <select
          value={chain ?? ""}
          disabled={chain === undefined}
          onChange={(e) => void choose(e.target.value)}
          // The shell binds bare keys; a control with a keyboard of its own must keep it.
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          aria-label={label}
        >
          <option value="">{none}</option>
          {/* What is stored, even when the library no longer holds it: a renamed chain must not read as "nothing is set". */}
          {(chains.includes(chain ?? "") || !chain
            ? chains
            : [chain, ...chains]
          ).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{body}</p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {/* An empty list is a real state — a library with no chain yet — and reads as a broken screen unless it says so. */}
        {chains.length === 0 ? (
          <p className="text-xs text-muted-foreground">{noChains}</p>
        ) : null}
      </div>
    </div>
  );
}
