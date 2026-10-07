// The CTRL tab: the current item, transport, levels, and judging the player who buzzed.
// Until a session is chosen it shows the session picker instead, because nothing else can act yet.

import { Alert, AlertDescription, AlertTitle } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  AlertTriangle,
  Download,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";
import type { Remote } from "../remote/useRemote";
import { HoldButton } from "./HoldButton";
import { itemLabel, peekLabel } from "./labels";

export function ControlsTab({
  r,
  phaseLabel,
  sessionPicker,
}: {
  r: Remote;
  phaseLabel: string;
  sessionPicker: ReactNode;
}) {
  const { g, render } = r;
  const activeSessionName =
    g.sessions.find((s) => s.id === g.activeSessionId)?.name ?? "";
  const showSessionPicker = g.activeSessionId === 0 || g.sessionPickerOpen;
  const peek = peekLabel(g.peekInfo);

  return (
    <>
      {g.activeSessionId !== 0 && (
        <Card className="flex shrink-0 items-center gap-3 p-3">
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
            {m["remote.session"]()}
          </span>
          <span className="min-w-0 flex-1 break-words font-semibold text-primary">
            {activeSessionName || `#${g.activeSessionId}`}
          </span>
          <Button
            size="sm"
            variant={g.sessionPickerOpen ? "secondary" : "outline"}
            onClick={() => {
              g.sessionPickerOpen = !g.sessionPickerOpen;
              render();
            }}
          >
            {g.sessionPickerOpen ? m["remote.cancel"]() : m["remote.change"]()}
          </Button>
        </Card>
      )}

      {showSessionPicker ? (
        sessionPicker
      ) : (
        <>
          <Card className="shrink-0 p-3 text-center">
            <div className="break-words text-base font-semibold text-primary">
              {itemLabel(g.currentItem) || phaseLabel}
            </div>
          </Card>

          {g.preloading && (
            <Alert className="shrink-0">
              <Download />
              <AlertTitle>
                {m["remote.loading"]({
                  loaded: g.preloadLoaded,
                  total: g.preloadTotal,
                })}
              </AlertTitle>
              <AlertDescription className="w-full">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-amber transition-[width] duration-200"
                    style={{ width: `${g.preloadProgress * 100}%` }}
                  />
                </div>
              </AlertDescription>
            </Alert>
          )}

          {g.preloadFailedPaths.length > 0 && (
            <Alert variant="destructive" className="shrink-0">
              <AlertTriangle />
              <AlertTitle>{m["remote.preloadFailed"]()}</AlertTitle>
              <AlertDescription>
                <ul className="flex max-h-30 flex-col gap-0.5 overflow-y-auto">
                  {g.preloadFailedPaths.map((path) => (
                    <li key={path} className="break-all font-mono text-xs">
                      {path}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {peek && (
            <p className="shrink-0 text-center text-xs text-muted-foreground">
              {m["remote.next"]({ label: peek })}
            </p>
          )}

          <Transport r={r} />
          <Levels r={r} />

          {g.latestBuzzer &&
            (g.gamePhase === "answering" || g.gamePhase === "song") && (
              <Judging r={r} />
            )}
        </>
      )}
    </>
  );
}

function Transport({ r }: { r: Remote }) {
  const { g, a } = r;
  const isTransportEnabled = ["song", "answering"].includes(g.gamePhase);
  const isSongPhase = ["song", "answering", "judging"].includes(g.gamePhase);
  const isPlayingActive = g.audioPlaying && !g.audioPaused;
  return (
    <div className="grid shrink-0 grid-cols-3 gap-2">
      <Button
        variant="secondary"
        className="h-14 touch-manipulation"
        disabled={!isTransportEnabled}
        aria-label={isPlayingActive ? m["remote.pause"]() : m["remote.play"]()}
        onClick={() => a.sendAudioCommand(isPlayingActive ? "pause" : "play")}
      >
        {isPlayingActive ? (
          <Pause className="size-7" />
        ) : (
          <Play className="size-7" />
        )}
      </Button>
      <Button
        variant="secondary"
        className="h-14 touch-manipulation"
        disabled={!isTransportEnabled}
        aria-label={m["remote.replay"]()}
        onClick={() => a.sendAudioCommand("replay")}
      >
        <RotateCcw className="size-7" />
      </Button>
      <HoldButton
        variant="outline"
        className="h-14 whitespace-normal border-amber text-amber"
        fillClassName="bg-destructive/30"
        disabled={!isSongPhase}
        seconds={5}
        onComplete={a.skip}
        label={(holding, progress) =>
          holding
            ? m["remote.skipCountdown"]({
                seconds: Math.ceil((1 - progress) * 5),
              })
            : m["remote.holdSkip"]()
        }
      />
      <HoldButton
        className="col-span-3 h-20 text-base"
        fillClassName="bg-white/25"
        disabled={a.nextDisabled()}
        canStart={() => !a.nextDisabled()}
        seconds={1}
        onComplete={a.next}
        label={(holding, progress) =>
          holding
            ? m["remote.nextCountdown"]({ seconds: Math.ceil(1 - progress) })
            : m["remote.nextBtn"]()
        }
      />
    </div>
  );
}

function Levels({ r }: { r: Remote }) {
  const { g, a, render, socket } = r;
  return (
    <div className="flex shrink-0 flex-col gap-3 py-1">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant={g.isMuted ? "destructive" : "secondary"}
          className="min-w-20"
          onClick={() => {
            g.isMuted = !g.isMuted;
            a.sendAudioCommand("set_gain", {
              value: g.isMuted ? 0 : g.gainLevel / 100,
            });
            render();
          }}
        >
          {g.isMuted ? <VolumeX /> : <Volume2 />}
          {g.isMuted ? m["remote.muted"]() : m["remote.vol"]()}
        </Button>
        <input
          type="range"
          min={0}
          max={100}
          value={g.gainLevel}
          aria-label={m["remote.vol"]()}
          className="h-2 min-w-0 flex-1 accent-primary"
          onChange={(e) => {
            g.gainLevel = Number(e.target.value);
            g.isMuted = false;
            a.sendAudioCommand("set_gain", { value: g.gainLevel / 100 });
            render();
          }}
        />
        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
          {g.isMuted ? 0 : g.gainLevel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Badge
          variant={g.micEnabled ? "rec" : "default"}
          className="h-7 min-w-20 rounded-md"
        >
          {g.micEnabled ? (
            <Mic className="size-3" />
          ) : (
            <MicOff className="size-3" />
          )}
          {g.micEnabled ? m["remote.micOn"]() : m["remote.micOff"]()}
        </Badge>
        <input
          type="range"
          min={0}
          max={200}
          value={g.micGainPct}
          aria-label={m["remote.micOn"]()}
          className="h-2 min-w-0 flex-1 accent-primary"
          onChange={(e) => {
            g.micGainPct = Number(e.target.value);
            socket.send({
              type: "remote_action",
              payload: { action: "set_mic_gain", gainPct: g.micGainPct },
            });
            render();
          }}
        />
        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
          {g.micGainPct}
        </span>
      </div>
    </div>
  );
}

function Judging({ r }: { r: Remote }) {
  const { g, a } = r;
  const low = g.answerRemaining <= 3;
  const buzzer = g.latestBuzzer ?? "";
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="p-2 text-center text-xl font-bold tracking-wide text-amber">
        {buzzer.toUpperCase()} (
        {g.players.find((p) => p.name === buzzer)?.score ?? 0})
      </div>
      {g.gamePhase === "answering" && (
        <Card
          className={cn("flex flex-col gap-2 p-3", low && "border-destructive")}
        >
          <div
            className={cn(
              "text-center text-2xl font-bold tabular-nums",
              low ? "text-destructive" : "text-primary",
            )}
          >
            {g.answerRemaining.toFixed(1)}S
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full transition-[width] duration-100 ease-linear",
                low ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${(g.answerRemaining / 12) * 100}%` }}
            />
          </div>
        </Card>
      )}
      <Button
        size="lg"
        className="h-auto flex-1 bg-green py-6 text-lg text-background hover:bg-green/90"
        onClick={() => void a.goodResponse()}
      >
        {m["remote.goodResponse"]()}
      </Button>
      <Button
        size="lg"
        variant="destructive"
        className="h-auto flex-1 py-6 text-lg"
        onClick={() => void a.badResponse()}
      >
        {m["remote.badResponse"]()}
      </Button>
    </div>
  );
}
