// FrozenChainsPage.tsx — `/libraries/chains`: the account's frozen chains, built here and kept in its own
// library (`@account/chains/`), and the libraries' cold chains beside them, read-only, to copy from.
// A saved chain is what `clip process` and the recorder's live chains already read. See ../../docs/frozenChains.md.

import { Button } from "@frediverse/ui/button";
import {
  Copy,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Snowflake,
  Trash2,
} from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { Toaster } from "@studio/project-shell/toast";
import type {
  ChainModule,
  FrozenChain,
  FrozenChainStep,
} from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { AskHostK7 } from "../AskHostK7";
import { m } from "../paraglide/messages.js";
import { findLibraryFiles } from "../settings/accountFiles";
import { type AccountFiles, accountFiles } from "./api";
import { FrozenChainBuilder } from "./FrozenChainBuilder";
import { HomeShell } from "./HomeFrame";
import { PageFrame } from "./PageFrame";

type Draft = { name: string; steps: FrozenChainStep[]; existing: boolean };

/** A copy's name: the source's last segment, numbered past the account's own names. */
function copyName(ref: string, taken: Set<string>): string {
  const base = (ref.split("/").pop() ?? "chain").replace(
    /[^A-Za-z0-9_-]+/g,
    "-",
  );
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

function Row({
  chain,
  onEdit,
  onCopy,
  onDelete,
}: {
  chain: FrozenChain;
  onEdit?: () => void;
  onCopy: () => void;
  onDelete?: () => void;
}) {
  const summary = chain.unreadable
    ? chain.unreadable
    : chain.steps
        .map(
          (s) => `${s.module.split("/").pop()}${s.bypass ? " (bypass)" : ""}`,
        )
        .join(" → ");
  return (
    <li className="flex items-center gap-3 rounded px-2 py-2 hover:bg-muted/40">
      {chain.cold ? (
        <Snowflake className="size-4 shrink-0 text-sky-400" />
      ) : (
        <Radio className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">{chain.ref}</span>
        <span
          className={`block truncate text-xs ${chain.unreadable ? "text-destructive" : "text-muted-foreground"}`}
          title={summary}
        >
          {summary}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {chain.liveRefusal
            ? m["frozen.notLive"]({ why: chain.liveRefusal })
            : m["frozen.live"]()}
        </span>
      </span>
      {onEdit && (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onEdit}
          aria-label={m["frozen.edit"]()}
          title={m["frozen.edit"]()}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onCopy}
        aria-label={m["frozen.duplicate"]()}
        title={m["frozen.duplicate"]()}
      >
        <Copy className="size-3.5" />
      </Button>
      {onDelete && (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onDelete}
          aria-label={m["frozen.delete"]()}
          title={m["frozen.delete"]()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

export function FrozenChainsPage() {
  // `undefined` while asked, `null` when no file service answers.
  const [files, setFiles] = useState<AccountFiles | null | undefined>(
    undefined,
  );
  const [chains, setChains] = useState<FrozenChain[] | null>(null);
  const [modules, setModules] = useState<ChainModule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (f: AccountFiles) => {
    try {
      setChains(await accountFiles.frozenChains(f));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let live = true;
    void findLibraryFiles().then((f) => {
      if (!live) return;
      setFiles(f);
      if (!f) return;
      void reload(f);
      void accountFiles
        .chainModules(f)
        .then((ms) => live && setModules(ms))
        .catch((e: Error) => live && setError(e.message));
    });
    return () => {
      live = false;
    };
  }, [reload]);

  const mine = (chains ?? []).filter((c) => c.mine);
  const cold = (chains ?? []).filter((c) => !c.mine);
  const taken = new Set(mine.map((c) => c.name));

  const remove = async (c: FrozenChain) => {
    if (!files) return;
    const ok = await askConfirm({
      title: m["frozen.deleteTitle"]({ name: c.name }),
      body: m["frozen.deleteBody"](),
      confirmLabel: m["frozen.delete"](),
      danger: true,
    });
    if (!ok) return;
    try {
      await accountFiles.deleteFrozenChain(files, c.name);
      await reload(files);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // A copy drops the step ids: two chains sharing an id would share their presets' file names.
  const copyOf = (c: FrozenChain): Draft => ({
    name: copyName(c.name, taken),
    steps: c.steps.map(({ id: _, ...s }) => s),
    existing: false,
  });

  return (
    <HomeShell>
      <AskHostK7 />
      <Toaster dismissLabel={m["common.dismiss"]()} />
      <PageFrame
        title={m["frozen.title"]()}
        summary={m["frozen.summary"]()}
        actions={
          files && !draft ? (
            <Button
              size="sm"
              onClick={() =>
                setDraft({
                  name: "",
                  steps: [{ module: "", params: {} }],
                  existing: false,
                })
              }
            >
              <Plus className="size-3.5" /> {m["frozen.new"]()}
            </Button>
          ) : null
        }
      >
        {files === undefined || (files && chains === null && !error) ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="size-3.5 animate-spin" /> {m["libs.reading"]()}
          </div>
        ) : files === null ? (
          <p className="text-muted-foreground text-sm">
            {m["frozen.noServer"]()}
          </p>
        ) : (
          <div className="space-y-6">
            {error && <p className="text-destructive text-sm">{error}</p>}
            {draft && (
              <FrozenChainBuilder
                // A new key per opening, so a second draft starts from its own steps.
                key={`${draft.name}:${draft.existing}`}
                files={files}
                modules={modules}
                initial={draft}
                onCancel={() => setDraft(null)}
                onSaved={() => {
                  setDraft(null);
                  void reload(files);
                }}
              />
            )}
            <section>
              <h2 className="mb-1 font-medium text-sm">{m["frozen.mine"]()}</h2>
              {mine.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {m["frozen.mineEmpty"]()}
                </p>
              ) : (
                <ul>
                  {mine.map((c) => (
                    <Row
                      key={c.ref}
                      chain={c}
                      onEdit={() =>
                        setDraft({
                          name: c.name,
                          steps: c.steps,
                          existing: true,
                        })
                      }
                      onCopy={() => setDraft(copyOf(c))}
                      onDelete={() => void remove(c)}
                    />
                  ))}
                </ul>
              )}
              <p className="mt-2 text-muted-foreground text-xs">
                {m["frozen.howToUse"]()}
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-medium text-sm">{m["frozen.cold"]()}</h2>
              {cold.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {m["frozen.coldEmpty"]()}
                </p>
              ) : (
                <ul>
                  {cold.map((c) => (
                    <Row
                      key={c.ref}
                      chain={c}
                      onCopy={() => setDraft(copyOf(c))}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </PageFrame>
    </HomeShell>
  );
}
