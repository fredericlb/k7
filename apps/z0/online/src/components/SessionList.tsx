import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@frediverse/ui/card";
import { Loader2, RefreshCw, Star } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { LoadProgress, SessionRow } from "z0-shared/types";
import { m } from "../paraglide/messages.js";
import { MaybeTip, Tip } from "./Tip";

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
        <Tip label={m["picker.refresh"]()}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m["picker.refresh"]()}
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </Tip>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {m["picker.loading"]()}
          </p>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["picker.empty"]()}</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-1">
              <Button
                variant={s.id === activeId ? "secondary" : "outline"}
                disabled={selecting !== 0}
                aria-current={s.id === activeId || undefined}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "h-auto w-full flex-wrap justify-start gap-3 px-3.5 py-3 font-normal",
                  s.id === activeId
                    ? "border border-primary"
                    : s.resume && "border-amber/50 hover:border-amber",
                )}
              >
                {(selecting === s.id || progress?.id === s.id) && (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.resume ? (
                  <MaybeTip
                    label={
                      s.resume.total
                        ? m["picker.resumeCount"]({
                            played: s.resume.played ?? 0,
                            total: s.resume.total ?? 0,
                          })
                        : ""
                    }
                  >
                    <span className="ml-auto flex items-center gap-2 tabular-nums">
                      {((s.resume.played ?? 0) > 0 ||
                        (s.resume.total ?? 0) > 0) && (
                        <span className="text-xs text-amber">
                          {s.resume.played ?? 0} / {s.resume.total ?? 0}
                        </span>
                      )}
                      <Badge variant="amber">{m["picker.resume"]()}</Badge>
                    </span>
                  </MaybeTip>
                ) : typeof s.score === "number" ? (
                  <Tip label={m["picker.bestScore"]()}>
                    <Badge
                      variant="default"
                      className="ml-auto text-green tabular-nums"
                    >
                      <Star className="size-3.5" /> {s.score}
                    </Badge>
                  </Tip>
                ) : null}
              </Button>
              {progress && progress.id === s.id && progress.total > 0 && (
                <MaybeTip label={progress.name || ""}>
                  {/* A bespoke bar: commons has no progress component. */}
                  <div className="relative h-3.5 overflow-hidden rounded-sm border border-border bg-background">
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
                </MaybeTip>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
