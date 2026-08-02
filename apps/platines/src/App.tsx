// App.tsx — platines v1: the médiathèque's cached morceaux down one side, one deck on the
// other. Pick a song, the engine plays it out of the interface. Nothing else yet — the
// chains view and a second deck are what this is a foundation for.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Input } from "@frediverse/ui/input";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Disc3, Headphones, Loader2, Play, Plug, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { loadAndPlay } from "./deck";
import {
  loadSettings,
  playablePath,
  type Settings,
  saveSettings,
  service,
} from "./service";
import { useEngine } from "./useEngine";

export function App() {
  const deck = useEngine();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<MediatekEntry | null>(null);

  const refresh = useCallback(async (s: Settings) => {
    try {
      const sum = await service.summary(s);
      setRoot(sum.root);
      setEntries((await service.morceaux(s)).entries);
      setError(null);
    } catch (e) {
      setEntries(null);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh(settings);
  }, [settings, refresh]);

  const start = (e: MediatekEntry) => {
    if (!deck.engine || !root) return;
    const abs = playablePath(root, e);
    // Said out loud rather than swallowed: a catalogued folder with no audio is a real
    // state — a mirror that failed halfway — and a dead Play button explains nothing.
    if (!abs)
      return setError(
        `${e.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    setLoaded(e);
    loadAndPlay(deck.engine, abs, e.name);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-baseline gap-3 border-b px-6 py-3">
        <span className="text-lg font-semibold tracking-tight">platines</span>
        <span className="text-xs text-muted-foreground">
          la médiathèque, jouée par le moteur
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {deck.phase.k === "ready" ? (
            <span className="text-muted-foreground">
              moteur {deck.phase.id}
            </span>
          ) : deck.phase.k === "looking" ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> recherche du
              moteur…
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Plug className="h-3.5 w-3.5" /> aucun moteur — lance le capot
              <button type="button" className="underline" onClick={deck.retry}>
                réessayer
              </button>
            </span>
          )}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {error ? (
            <Card className="mb-4 p-4 text-sm text-destructive">{error}</Card>
          ) : null}
          {entries === null ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Pas de service local joignable. platines lit le CACHE de la
              médiathèque, pas la bibliothèque hébergée — c'est le moteur qui
              joue, et il ouvre des fichiers.
            </Card>
          ) : entries.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Aucun morceau dans le cache de cette machine.
            </Card>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className={`flex items-baseline gap-3 rounded-md px-3 py-2 ${
                    loaded?.id === e.id ? "bg-accent/60" : "hover:bg-accent/30"
                  }`}
                >
                  <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {e.meta?.artist ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {String(e.meta.artist)}
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={deck.phase.k !== "ready" || !e.meta?.master}
                    // Disabled with a reason, not just greyed: a folder with no audio and
                    // an absent engine are different problems.
                    title={
                      !e.meta?.master
                        ? "ce dossier ne porte aucun audio"
                        : deck.phase.k !== "ready"
                          ? "aucun moteur sur cette machine"
                          : "jouer"
                    }
                    onClick={() => start(e)}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </main>

        <aside className="flex w-80 shrink-0 flex-col gap-4 border-l p-4">
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">Platine</div>
            <div className="mb-3 truncate text-sm text-muted-foreground">
              {loaded ? loaded.name : "rien de chargé"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={deck.playing ? "default" : "secondary"}
                disabled={!deck.engine || !loaded}
                onClick={() =>
                  deck.engine?.transport(deck.playing ? "stop" : "play")
                }
              >
                {deck.playing ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {deck.playing ? "en lecture" : "arrêté"}
              </span>
            </div>
          </Card>

          <Card className="p-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deck.listening}
                onChange={(ev) => deck.setListening(ev.target.checked)}
              />
              <Headphones className="h-4 w-4 text-muted-foreground" />
              Écouter ici
            </label>
            {/* Off by default: the sound already comes out of the machine's interface, so
                this doubles it. It is here because it is what étape 7 was for — and because
                on a laptop with no monitors it is the only way to hear anything. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Le son sort déjà de l'interface de cette machine. Cochez pour
              l'entendre aussi dans cet onglet.
            </p>
            {deck.listening ? (
              <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                tampon {deck.listenStats.depth} · manques{" "}
                {deck.listenStats.underruns}
              </p>
            ) : null}
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">Service local</div>
            <Input
              className="mb-2 h-8 text-xs"
              value={settings.service}
              placeholder="http://127.0.0.1:8770"
              onChange={(ev) =>
                setSettings((s) => ({ ...s, service: ev.target.value }))
              }
            />
            <Input
              className="h-8 text-xs"
              value={settings.user}
              placeholder="utilisateur"
              onChange={(ev) =>
                setSettings((s) => ({ ...s, user: ev.target.value }))
              }
            />
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                saveSettings(settings);
                void refresh(settings);
              }}
            >
              Enregistrer
            </Button>
            {root ? (
              <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                {root}
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
