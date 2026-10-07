// The session list, on commons' Card, Button and Badge: a host stylesheet styles none of it.
// Hosts compile z0-shared themselves: their Tailwind must @source this folder, or these classes vanish.

import { Alert, AlertTitle } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@frediverse/ui/card";
import { Loader2, Play, RefreshCw, Star } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { LoadProgress, SessionRow } from "./types";

// Presentational: the host owns the data, and this only emits select(id) and refresh().
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
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading}
            onClick={onRefresh}
            aria-label="refresh"
            title="refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">loading…</p>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">no sessions in grist</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex flex-col gap-1">
                <Button
                  variant={s.id === activeId ? "secondary" : "outline"}
                  className={cn(
                    "h-auto w-full flex-wrap gap-3 px-3 py-3 text-left whitespace-normal",
                    s.resume && "border-amber",
                    selecting === s.id && "opacity-50",
                  )}
                  disabled={selecting !== 0}
                  onClick={() => onSelect(s.id)}
                >
                  {(selecting === s.id ||
                    (progress && progress.id === s.id)) && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.resume ? (
                    <span
                      className="ml-auto flex items-center gap-2"
                      title={
                        s.resume.total
                          ? `continue from song ${s.resume.played ?? 0} of ${s.resume.total}`
                          : "continue your unfinished run"
                      }
                    >
                      {((s.resume.played ?? 0) > 0 ||
                        (s.resume.total ?? 0) > 0) && (
                        <span className="text-xs text-amber tabular-nums">
                          {s.resume.played ?? 0} / {s.resume.total ?? 0} songs
                        </span>
                      )}
                      <Badge variant="amber">
                        <Play className="size-3" /> RESUME
                      </Badge>
                    </span>
                  ) : typeof s.score === "number" ? (
                    <Badge className="ml-auto" title="your best solo score">
                      <Star className="size-3.5" /> {s.score}
                    </Badge>
                  ) : null}
                </Button>
                {progress && progress.id === s.id && progress.total > 0 && (
                  <div
                    className="relative h-6 overflow-hidden rounded-md bg-secondary"
                    title={progress.name || ""}
                  >
                    <div
                      className="h-full bg-primary/20"
                      style={{
                        width: `${(progress.done / progress.total) * 100}%`,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs">
                      caching audio · {progress.done}/{progress.total}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
