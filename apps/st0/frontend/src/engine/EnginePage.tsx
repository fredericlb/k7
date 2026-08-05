// EnginePage.tsx — the cog's « État du moteur » : the tray's engine options, in the
// browser. Everything here talks to the ENGINE's own WebSocket or to its machine's file
// service; the supervisor has no network surface, so its verbs (start/stop/restart,
// preferred/fallback device, full rescan) stay in the tray — the page says so rather
// than pretending. Tray↔page mapping and limits: apps/st0/docs/engine-status.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  type EngineAudioDevice,
  EngineClient,
  type EngineEditPlugin,
  type EngineSessionInfo,
} from "@studio/engine-browser";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { formatLatency } from "@studio/web-protocol/quality";
import {
  AppWindow,
  Check,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { currentUser, engineMachine } from "../api";
import { EngineList } from "./EnginePicker";
import type { EngineChoice } from "./useEngineChoice";

/** The tray polls its menu at this rhythm; the page has no reason to be staler. */
const POLL_MS = 2500;

export function EnginePage({ choice }: { choice: EngineChoice }) {
  const chosen = choice.ranked.find((r) => r.engine.id === choice.chosenId);
  const wsUrl = chosen?.wsUrl ?? null;

  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<EngineSessionInfo[]>([]);
  const [devices, setDevices] = useState<EngineAudioDevice[]>([]);
  const [editPlugins, setEditPlugins] = useState<EngineEditPlugin[]>([]);
  // null = the engine has not answered yet — the tray's spinner state, kept distinct
  // from 0, which would read as "no plugins" about a scan that simply isn't done.
  const [pluginCount, setPluginCount] = useState<number | null>(null);
  const [maintenance, setMaintenance] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const clientRef = useRef<EngineClient | null>(null);

  // One socket, owned by this page. The one-socket-per-tab rule holds because this
  // section replaces the module editor on screen — useModuleEngine is not mounted here.
  useEffect(() => {
    setConnected(false);
    setSessions([]);
    setDevices([]);
    setEditPlugins([]);
    setPluginCount(null);
    if (!wsUrl) return;
    const client = new EngineClient(
      wsUrl,
      undefined,
      sessionFor(SESSIONS.st0, currentUser()),
    );
    clientRef.current = client;
    const offs = [
      client.onConnected((ok) => {
        setConnected(ok);
        if (!ok) return;
        client.listSessions();
        client.listAudioDevices();
        client.listEditPlugins();
        client.listPlugins();
      }),
      client.onSessions(setSessions),
      client.onAudioDevices(setDevices),
      client.onEditPlugins(setEditPlugins),
      client.onPlugins((list) => setPluginCount(list.length)),
    ];
    client.connect();
    const poll = setInterval(() => {
      client.listSessions();
      client.listEditPlugins();
    }, POLL_MS);
    return () => {
      for (const off of offs) off();
      clearInterval(poll);
      client.dispose();
      clientRef.current = null;
    };
  }, [wsUrl]);

  const rescan = () => {
    setPluginCount(null); // the spinner, until the fresh list lands
    clientRef.current?.rescanPlugins();
    clientRef.current?.listPlugins();
  };

  const clearWaveforms = () => {
    if (!choice.fileBase || !choice.token) return;
    setMaintenance("…");
    engineMachine
      .clearWaveforms(choice.fileBase, choice.token)
      .then((n) =>
        setMaintenance(
          `${n} entrée${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}`,
        ),
      )
      .catch((e: Error) => setMaintenance(`échec : ${e.message}`));
  };

  const loadLogs = () => {
    if (!choice.fileBase || !choice.token) return;
    engineMachine
      .logs(choice.fileBase, choice.token)
      .then(setLogLines)
      .catch(() => setLogLines(["(journal injoignable)"]));
  };

  const uiPlugins = editPlugins.filter((p) => p.hasNativePluginUI);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Moteur</h2>
        {chosen ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="font-medium">{chosen.engine.hostname}</span>
            <span className="text-xs text-muted-foreground">
              id {chosen.engine.id.slice(0, 8)}
            </span>
            {wsUrl && (
              <span className="text-xs text-muted-foreground">{wsUrl}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {chosen.latency
                ? formatLatency(chosen.latency)
                : "hors de portée"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucun moteur choisi — la liste ci-dessous vient de la médiathèque.
          </p>
        )}
        <div className="rounded-md border p-1">
          <EngineList
            ranked={choice.ranked}
            chosenId={choice.chosenId}
            onChoose={choice.choose}
            onRetry={choice.refresh}
          />
        </div>
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune application ne pilote ce moteur.
          </p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="truncate font-medium">
                  {s.project || "(vide)"}
                </span>
                <span className="text-xs text-muted-foreground">{s.id}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.tracks} pistes
                </span>
                {s.playing && <Play className="h-3.5 w-3.5 text-emerald-500" />}
                {s.listeners > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ♫{s.listeners}
                  </span>
                )}
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  title="Oublier cette session"
                  onClick={() => clientRef.current?.dropSession(s.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">Interface audio</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {connected ? "Aucune interface signalée." : "Moteur injoignable."}
          </p>
        ) : (
          <ul>
            {devices.map((d) => (
              <li key={`${d.type}:${d.name}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                  onClick={() =>
                    clientRef.current?.setAudioDevice(d.name, d.type)
                  }
                >
                  <Check
                    className={`h-3.5 w-3.5 ${d.current ? "" : "invisible"}`}
                  />
                  <span className="flex-1 truncate">
                    {d.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      [{d.type}]
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {d.inputs}→{d.outputs}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          L'interface préférée et le repli se règlent dans le capot : c'est une
          politique du superviseur, pas du moteur.
        </p>
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Plugins
          {pluginCount === null ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="tabular-nums">{pluginCount}</span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={rescan}
            disabled={!connected}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Réanalyser
          </Button>
          <span className="text-xs text-muted-foreground">
            Réanalyse incrémentale ; la réanalyse complète (cache purgé) reste
            au capot.
          </span>
        </div>
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">UI native des plugins</h2>
        {uiPlugins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun plugin avec une UI native.
          </p>
        ) : (
          <ul className="divide-y">
            {uiPlugins.map((p) => (
              <li
                key={`${p.session ?? ""}:${p.id}`}
                className="flex items-center gap-3 py-1.5 text-sm"
              >
                <span className="truncate">
                  {p.session ? (
                    <span className="text-xs text-muted-foreground">
                      {p.session} ·{" "}
                    </span>
                  ) : null}
                  {p.name}
                </span>
                <span className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    clientRef.current?.showNativePluginUI(p.id, p.session ?? "")
                  }
                >
                  <AppWindow className="mr-2 h-3.5 w-3.5" />
                  Ouvrir
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          La fenêtre s'ouvre sur l'écran de la machine du moteur.
        </p>
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">Maintenance</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!choice.fileBase || !choice.token}
            onClick={clearWaveforms}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Vider le cache waveform
          </Button>
          {maintenance && (
            <span className="text-xs text-muted-foreground">{maintenance}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!choice.fileBase || !choice.token}
            onClick={loadLogs}
          >
            Journal de la machine
          </Button>
        </div>
        {logLines && (
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-xs leading-5">
            {logLines.join("\n")}
          </pre>
        )}
      </Card>

      <Card className="space-y-1 p-5">
        <h2 className="text-sm font-semibold">Cycle de vie</h2>
        <p className="text-sm text-muted-foreground">
          Démarrer, arrêter ou redémarrer le moteur — et relancer le file
          service — restent des gestes du capot : le superviseur n'écoute que le
          tray qui l'a lancé, et n'expose aucune surface réseau. C'est un choix
          de sécurité, pas un oubli.
        </p>
      </Card>
    </div>
  );
}
