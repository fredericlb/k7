// The auto-fetch pipeline's progress bar, cut into its four steps with each one's name inside.
// Steps before the current one are done; one entered later (an upload starts at stems) counts too.

import { m } from "../paraglide/messages.js";
import type { FetchStatus } from "../types";

type RunningPhase = Exclude<FetchStatus["phase"], "" | "failed">;

const STEPS: { phase: RunningPhase; label: () => string }[] = [
  { phase: "searching", label: m["fetch.step.search"] },
  { phase: "downloading", label: m["fetch.step.download"] },
  { phase: "stemming", label: m["fetch.step.stems"] },
  { phase: "matching-lyrics", label: m["fetch.step.lyrics"] },
];

const DOING: Record<RunningPhase, () => string> = {
  searching: m["fetch.searching"],
  downloading: m["fetch.downloading"],
  stemming: m["fetch.stemming"],
  "matching-lyrics": m["fetch.lyrics"],
};

export function FetchStepper({ phase, progress }: FetchStatus) {
  if (phase === "" || phase === "failed") return null;
  const current = STEPS.findIndex((s) => s.phase === phase);
  const percent =
    phase === "stemming" && progress !== null ? Math.round(progress) : null;
  return (
    <div className="song-fetch-status">
      <span className="muted small">
        {percent === null
          ? DOING[phase]()
          : m["fetch.stemmingPercent"]({ percent })}
      </span>
      <ol
        className="song-fetch-stepper"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={current + 1}
        aria-valuetext={DOING[phase]()}
      >
        {STEPS.map((step, i) => {
          const state =
            i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={step.phase} className={`song-fetch-step ${state}`}>
              {state === "active" && (
                <span
                  className={`song-fetch-step-fill${percent === null ? " indeterminate" : ""}`}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              )}
              <span className="song-fetch-step-label">
                <span className="song-fetch-step-num">{i + 1}</span>
                {step.label()}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
