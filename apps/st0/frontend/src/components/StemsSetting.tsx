// StemsSetting.tsx — WHICH CHAIN separates a record into stems, asked once. A section of the I/O
// tab, because it is the same kind of fact as the interface above it: something about this
// MACHINE that every project then works against.
//
// It is here rather than on the screens that use it — the playlist panel's « Séparer les stems »,
// a desk catching up on an unprepared record — and that placement is the feature. Which module
// separates and which model it wants does not vary by set list, so a picker beside the button
// asked the same question of the same person every time, and three surfaces asking would be three
// places to get it wrong. See ../docs/playlists.md.

import { MEDIATEK_REF } from "@studio/song-schema/songRef";
import { Split } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

export function StemsSetting({
  /** Dispatches `system stems <ref>` — the verb that writes the preference, so this control and
   *  the command bar are one road. */
  onRun,
}: {
  onRun: (line: string) => Promise<void>;
}) {
  /** What the machine remembers: a ref, `null` for "never told", `undefined` while reading. */
  const [chain, setChain] = useState<string | null | undefined>(undefined);
  /** The library's chains, as `@st0/…` refs. Empty for an account with no library repository,
   *  which is a fact rather than an error — the select says so. */
  const [chains, setChains] = useState<string[]>([]);
  const [error, setError] = useState("");

  const read = useCallback(() => {
    void api
      .preferences()
      .then((p) => setChain(p.stemsChain))
      .catch((e: Error) => {
        setChain(null);
        setError(e.message);
      });
  }, []);
  useEffect(read, [read]);
  useEffect(() => {
    void api
      .libraryChains()
      .then((r) => setChains(r.chains.map((c) => `${MEDIATEK_REF}/${c.ref}`)))
      .catch(() => setChains([]));
  }, []);

  /**
   * Set it, then RE-READ it.
   *
   * The command is what writes, and it can refuse — a chain that treats rather than separates is
   * turned down by name (`system.stems`). So the control does not assume it won: it asks the
   * machine again, and a refused pick snaps back to what is actually stored rather than showing a
   * choice nothing kept.
   */
  const choose = async (ref: string) => {
    setError("");
    // `""` is how the verb is told to clear it — quotes and all, since an empty argument is what
    // asks the verb for its usage instead.
    await onRun(`system stems ${ref || '""'}`);
    read();
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Split className="h-3 w-3" />
        séparation des stems
      </div>
      <div className="flex flex-col gap-1.5 px-2">
        <select
          value={chain ?? ""}
          disabled={chain === undefined}
          onChange={(e) => void choose(e.target.value)}
          // The shell binds bare keys; a control with a keyboard of its own must keep it.
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          aria-label="la chaîne qui sépare un morceau en stems"
        >
          <option value="">— aucune : cette machine ne sépare rien —</option>
          {/* What is stored, even when the library no longer holds it. Dropping it would make a
              chain somebody renamed look like "nothing is set", which is the wrong repair. */}
          {(chains.includes(chain ?? "") || !chain
            ? chains
            : [chain, ...chains]
          ).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Ce que « Séparer les stems » et les potards d'une platine utilisent.
          Une chaîne d'un seul pas hors ligne — le modèle qu'elle nomme doit
          être sur cette machine.
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {/* An empty list is a real state — an account whose library holds no chain yet — and it
            reads as a broken screen unless it says so. */}
        {chains.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Votre dépôt de bibliothèques ne contient aucune chaîne. Écrivez-en
            une sous <span className="font-mono">chains/</span> — un pas, le
            module qui sépare.
          </p>
        ) : null}
      </div>
    </div>
  );
}
