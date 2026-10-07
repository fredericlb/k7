// The monitor's side panels, each a commons Card subscribed to its own slice of the system.
// The range inputs stay native: @frediverse/ui has no slider.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent, CardTitle } from "@frediverse/ui/card";
import { Label } from "@frediverse/ui/label";
import { cn } from "@frediverse/ui/lib/utils";
import { Switch } from "@frediverse/ui/switch";
import { usePreloaderState } from "@studio/player-web/preloader";
import type { ReactNode } from "react";
import { useAudioUIState } from "../lib/audioPlayback";
import { useMicState } from "../lib/mic";
import type { MonitorSystem } from "../lib/system";

export function Panel({
  title,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex min-h-0 flex-col gap-2 p-3", className)}>
      <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </CardTitle>
      <CardContent className={cn("min-h-0", bodyClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

export function Row({
  label,
  htmlFor,
  children,
}: {
  label?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 text-xs">
      {label && (
        <Label
          htmlFor={htmlFor}
          className="w-16 shrink-0 text-xs uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </Label>
      )}
      {children}
    </div>
  );
}

const RANGE = "min-w-0 flex-1 accent-primary";
const VALUE = "w-10 shrink-0 text-right tabular-nums";

export function AudioPanel({ sys }: { sys: MonitorSystem }) {
  const audioUI = useAudioUIState(sys.audio);
  const pre = usePreloaderState(sys.audio.preloader);
  const vol = Math.round(audioUI.masterGain * 100);
  const progress = Math.round(pre.progress * 100);
  return (
    <Panel title="Audio" bodyClassName="flex flex-col gap-2">
      <Row label="Playing">
        {pre.isPlaying ? (
          <Badge variant={pre.isPaused ? "amber" : "tag"}>
            {pre.isPaused ? "paused" : "playing"}
          </Badge>
        ) : (
          <Badge>idle</Badge>
        )}
      </Row>
      <Row label="Mode">
        <span>{audioUI.currentMode || "—"}</span>
      </Row>
      <Row label="Vol" htmlFor="monitor-vol">
        <input
          id="monitor-vol"
          className={RANGE}
          type="range"
          min={0}
          max={100}
          value={vol}
          onChange={(e) => sys.audio.setVolume(Number(e.target.value) / 100)}
        />
        <span className={VALUE}>{vol}%</span>
        <Button
          variant="outline"
          size="xs"
          className="w-16"
          onClick={() => sys.audio.toggleMute()}
        >
          {audioUI.muted ? "Unmute" : "Mute"}
        </Button>
      </Row>
      {pre.loading && (
        <Row label="Loading">
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 tabular-nums">
            {pre.loaded}/{pre.total}
          </span>
        </Row>
      )}
      {pre.failedPaths.length > 0 && (
        <Row label="Failed">
          <Badge variant="rec">{pre.failedPaths.length} path(s)</Badge>
        </Row>
      )}
    </Panel>
  );
}

export function MicPanel({ sys }: { sys: MonitorSystem }) {
  const mic = useMicState(sys.mic);
  return (
    <Panel title="Mic" bodyClassName="flex flex-col gap-2">
      <Row label="State" htmlFor="monitor-mic">
        <Switch
          id="monitor-mic"
          checked={mic.enabled}
          onCheckedChange={() => void sys.mic.toggle()}
        />
        {mic.enabled ? <Badge variant="rec">live</Badge> : <Badge>off</Badge>}
      </Row>
      <Row label="Gain" htmlFor="monitor-gain">
        <input
          id="monitor-gain"
          className={RANGE}
          type="range"
          min={0}
          max={200}
          value={mic.gainPct}
          onChange={(e) => sys.mic.onGainInput(Number(e.target.value))}
        />
        <span className={VALUE}>{mic.gainPct}%</span>
      </Row>
      {mic.error && (
        <Row label="Error">
          <span className="text-destructive">{mic.error}</span>
        </Row>
      )}
    </Panel>
  );
}
