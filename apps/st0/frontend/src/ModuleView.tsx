// ModuleView.tsx — a module's files, READ-ONLY, and the way to the one place that can edit
// them. The builder used to live here; it lives in l8 now, on the bench. See ../docs/engine.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import {
  BENCH_PROJECT,
  BENCH_REPO,
  launchUrl,
} from "@studio/web-protocol/projects";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { moduleStore } from "./api";

/** The three files a module can carry, in the order the builder used to show them. */
const FILES = ["module.yaml", "ui.yaml", "presets.yaml"] as const;

export function ModuleView({
  entry,
  onBack,
}: {
  entry: MediatekEntry;
  onBack: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTexts({});
    setError(null);
    void (async () => {
      try {
        const read = await Promise.all(
          FILES.map((f) => moduleStore.read(`${entry.path}/${f}`)),
        );
        if (cancelled) return;
        setTexts(Object.fromEntries(FILES.map((f, i) => [f, read[i]])));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Catalogue
        </button>
        <span className="truncate text-sm font-semibold">{entry.path}</span>
        <span className="flex-1" />
        {/* The whole reason this screen is not a dead end. A module IS what a plugin is, so
            editing one blind was never worth much — the bench opens it in l8 against a real
            engine, and it is the one project allowed to write back here. */}
        <a
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          href={launchUrl(
            window.location.origin,
            BENCH_REPO,
            BENCH_PROJECT,
            "l8",
          )}
          target="_blank"
          rel="noopener"
        >
          <ExternalLink className="h-4 w-4" />
          Construire sur le banc
        </a>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <p className="mb-4 text-sm text-destructive">
            Lecture impossible : {error}
          </p>
        )}
        {FILES.map((f) => {
          const text = texts[f];
          // A module with no ui.yaml or presets.yaml is ordinary — say nothing about it rather
          // than showing an empty box per file a module simply does not have.
          if (text == null) return null;
          return (
            <section key={f} className="mb-6">
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {f}
              </h3>
              <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                {text}
              </pre>
            </section>
          );
        })}
      </div>
    </div>
  );
}
