import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@frediverse/ui/card";
import { Loader2, RefreshCw, Star } from "@frediverse/ui/icons";
import type { LoadProgress, SessionRow } from "z0-shared/types";
import { m } from "../paraglide/messages.js";

// z0-shared/session-picker's props, kept local so restyling here never touches remote's picker.
export function SessionList({
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
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          title={m["picker.refresh"]()}
          aria-label={m["picker.refresh"]()}
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {m["picker.loading"]()}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["picker.empty"]()}</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-1">
              <button
                type="button"
                disabled={selecting !== 0}
                onClick={() => onSelect(s.id)}
                className={[
                  "flex w-full flex-wrap items-center gap-3 rounded-md border px-3.5 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  s.id === activeId
                    ? "border-primary bg-secondary text-foreground"
                    : s.resume
                      ? "border-amber/50 bg-card text-foreground hover:border-amber"
                      : "border-border bg-card text-foreground hover:border-primary",
                ].join(" ")}
              >
                {(selecting === s.id || progress?.id === s.id) && (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.resume ? (
                  <span
                    className="ml-auto flex items-center gap-2 tabular-nums"
                    title={
                      s.resume.total
                        ? m["picker.resumeCount"]({
                            played: s.resume.played ?? 0,
                            total: s.resume.total ?? 0,
                          })
                        : undefined
                    }
                  >
                    {((s.resume.played ?? 0) > 0 ||
                      (s.resume.total ?? 0) > 0) && (
                      <span className="text-xs text-amber">
                        {s.resume.played ?? 0} / {s.resume.total ?? 0}
                      </span>
                    )}
                    <Badge variant="amber">{m["picker.resume"]()}</Badge>
                  </span>
                ) : typeof s.score === "number" ? (
                  <Badge
                    variant="default"
                    className="ml-auto text-green tabular-nums"
                    title={m["picker.bestScore"]()}
                  >
                    <Star className="size-3.5" /> {s.score}
                  </Badge>
                ) : null}
              </button>
              {progress && progress.id === s.id && progress.total > 0 && (
                <div
                  className="relative h-3.5 overflow-hidden rounded-sm border border-border bg-background"
                  title={progress.name || ""}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-green transition-[width] duration-150 ease-linear"
                    style={{
                      width: `${(progress.done / progress.total) * 100}%`,
                    }}
                  />
                  <span className="relative block text-center text-[10px] leading-3.5 text-foreground tabular-nums mix-blend-difference">
                    {m["picker.caching"]({
                      done: progress.done,
                      total: progress.total,
                    })}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
