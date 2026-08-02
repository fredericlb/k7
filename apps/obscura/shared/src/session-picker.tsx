import type { LoadProgress, SessionRow } from "./types";

// Presentational session picker (port of shared/components/SessionPicker.vue).
// The host owns the data; this emits select(id)/refresh().
export function SessionPicker({
  sessions,
  activeId = 0,
  loading = false,
  error = "",
  selecting = 0,
  progress = null,
  title = "SESSION",
  onSelect,
  onRefresh,
}: {
  sessions: SessionRow[];
  activeId?: number;
  loading?: boolean;
  error?: string;
  selecting?: number;
  progress?: LoadProgress | null;
  title?: string;
  onSelect: (id: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel">
      <header className="panel-title">
        ┤ {title} ├
        <button
          className="audio-btn refresh"
          disabled={loading}
          onClick={onRefresh}
        >
          ↻
        </button>
      </header>
      <div className="panel-body session-body">
        {loading && sessions.length === 0 ? (
          <div className="dim">loading…</div>
        ) : error ? (
          <div className="audio-val warn">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="dim">no sessions in grist</div>
        ) : (
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id}>
                <button
                  className={[
                    "session-row",
                    s.id === activeId ? "active" : "",
                    selecting === s.id ? "pending" : "",
                    s.resume ? "resumable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={selecting !== 0}
                  onClick={() => onSelect(s.id)}
                  style={{ width: "100%" }}
                >
                  {(selecting === s.id ||
                    (progress && progress.id === s.id)) && (
                    <span className="spinner" aria-hidden="true" />
                  )}
                  <span className="session-name">{s.name}</span>
                  {s.resume ? (
                    <span
                      className="session-resume"
                      title={
                        s.resume.total
                          ? `continue from song ${s.resume.played ?? 0} of ${s.resume.total}`
                          : "continue your unfinished run"
                      }
                    >
                      {((s.resume.played ?? 0) > 0 ||
                        (s.resume.total ?? 0) > 0) && (
                        <span className="resume-count">
                          {s.resume.played ?? 0} / {s.resume.total ?? 0} songs
                        </span>
                      )}
                      <span className="resume-tag">▶ RESUME</span>
                    </span>
                  ) : typeof s.score === "number" ? (
                    <span
                      className="session-score"
                      title="your best solo score"
                    >
                      ★ {s.score}
                    </span>
                  ) : null}
                </button>
                {progress && progress.id === s.id && progress.total > 0 && (
                  <div className="progress" title={progress.name || ""}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(progress.done / progress.total) * 100}%`,
                      }}
                    />
                    <span className="progress-label">
                      caching audio · {progress.done}/{progress.total}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
