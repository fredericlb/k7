// SessionWaveformPanel.tsx — the top of a session's page: its waveform with the detection drawn on
// it, the transport, the two detection sliders, and the selection a moment is saved from.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Circle, Diamond, Flag, Pause, Play } from "@frediverse/ui/icons";
import type { LiveValue } from "@studio/recorder";
import { fmtTime } from "../format";
import { m } from "../paraglide/messages.js";
import type { Envelope, EventsResult, Selection, Session } from "../types";
import { PlaybackTime, PlayheadWaveform } from "./Playhead";

interface Props {
  session: Session;
  envelope: Envelope | null;
  eventsResult: EventsResult | null;
  threshold: number | null;
  minSilence: number;
  clock: LiveValue<number>;
  playing: boolean;
  selection: Selection | null;
  editing: Selection | null;
  onSeek: (sec: number) => void;
  onSelect: (sel: Selection | null) => void;
  onEditRange: (range: Selection) => void;
  onTogglePlay: () => void;
  onAddMarker: (atSec: number) => void;
  onResume: () => void;
  onThresholdChange: (t: number) => void;
  onMinSilenceChange: (ms: number) => void;
  onSaveSelection: () => void;
}

export function SessionWaveformPanel(p: Props) {
  const { envelope, eventsResult, threshold, clock, selection } = p;
  return (
    <>
      {envelope && eventsResult && (
        <>
          <PlayheadWaveform
            clock={clock}
            envelope={envelope}
            duration={p.session.duration}
            threshold={threshold ?? eventsResult.threshold}
            events={eventsResult.events}
            annotations={p.session.annotations}
            markers={p.session.markers}
            selection={selection}
            onSeek={p.onSeek}
            onSelect={p.onSelect}
            onMarkerClick={(mk) => p.onSeek(mk.atSec)}
            editing={p.editing}
            onEditRange={p.onEditRange}
          />

          <div className="row playback-controls">
            <Button onClick={p.onTogglePlay}>
              {p.playing ? (
                <>
                  <Pause className="size-4" /> {m["common.pause"]()}
                </>
              ) : (
                <>
                  <Play className="size-4" /> {m["common.play"]()}
                </>
              )}
            </Button>
            <span className="muted small tabular">
              <PlaybackTime clock={clock} /> / {fmtTime(p.session.duration)}
            </span>
            <Button
              variant="outline"
              onClick={() => p.onAddMarker(clock.get())}
              title={m["marker.addTitle"]()}
            >
              <Flag className="size-4" /> {m["marker.add"]()}
            </Button>
            <Button
              variant="outline"
              className="ml-auto"
              onClick={p.onResume}
              title={m["session.continueTitle"]()}
            >
              <Circle className="size-3 fill-current text-destructive" />{" "}
              {m["session.continue"]()}
            </Button>
          </div>

          <Card className="controls">
            <div className="control">
              <label>
                {m["session.floor"]()}{" "}
                <b>
                  {(
                    ((threshold ?? 0) / (eventsResult.peak || 1)) *
                    100
                  ).toFixed(0)}
                  %
                </b>{" "}
                {m["session.ofPeak"]()}
              </label>
              <input
                type="range"
                min={0}
                max={eventsResult.peak || 1}
                step={(eventsResult.peak || 1) / 200}
                value={threshold ?? 0}
                onChange={(e) => p.onThresholdChange(Number(e.target.value))}
              />
            </div>
            <div className="control">
              <label>
                {m["session.minGap"]()} <b>{p.minSilence}s</b>
              </label>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={p.minSilence}
                onChange={(e) => p.onMinSilenceChange(Number(e.target.value))}
              />
            </div>
          </Card>

          {eventsResult.events.length === 0 && (
            <p className="muted small">{m["session.noneDetected"]()}</p>
          )}
        </>
      )}

      <Card id="comment-box" className="comment-box">
        <h3>{m["session.addMoment"]()}</h3>
        {selection ? (
          <div className="row">
            <span className="muted small">
              {m["session.selected"]({
                from: fmtTime(Math.min(selection.start, selection.end)),
                to: fmtTime(Math.max(selection.start, selection.end)),
              })}
            </span>
            <Button onClick={p.onSaveSelection}>
              <Diamond className="size-4" /> {m["session.saveMoment"]()}
            </Button>
            <Button variant="outline" onClick={() => p.onSelect(null)}>
              {m["session.clear"]()}
            </Button>
          </div>
        ) : (
          <p className="muted small">{m["session.selectHelp"]()}</p>
        )}
      </Card>
    </>
  );
}
