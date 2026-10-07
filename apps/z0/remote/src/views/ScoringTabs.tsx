// The MANUAL tab (score whoever answered, by hand) and the BUZZ tab (buzz in as any player, for testing).

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { m } from "../paraglide/messages.js";
import type { Remote } from "../remote/useRemote";

export function SectionHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="col-span-full p-5 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function ManualTab({ r }: { r: Remote }) {
  const { g, a } = r;
  const canScore = ["song", "answering"].includes(g.gamePhase);
  const latest = g.latestBuzzer;
  return (
    <>
      <SectionHeader>{m["remote.score"]()}</SectionHeader>
      <div className="flex flex-col gap-2">
        {latest && (
          <Button
            size="lg"
            className="h-14 text-base"
            disabled={!canScore}
            onClick={() => void a.scorePlayer(latest)}
          >
            {m["remote.latest"]({ name: latest.toUpperCase() })} (
            {g.players.find((p) => p.name === latest)?.score ?? 0})
          </Button>
        )}
        {g.players.map((p) => (
          <Button
            key={p.deviceId || p.name}
            size="lg"
            variant="outline"
            className={cn(
              "h-12",
              p.name === latest && "border-green bg-green/10 text-green",
            )}
            disabled={!canScore}
            onClick={() => void a.scorePlayer(p.name)}
          >
            {p.name.toUpperCase()} ({p.score})
          </Button>
        ))}
        <Button
          size="lg"
          variant="destructive"
          className="h-12"
          disabled={!canScore}
          onClick={a.noWinner}
        >
          {m["remote.noWinner"]()}
        </Button>
      </div>
    </>
  );
}

export function BuzzersTab({ r }: { r: Remote }) {
  const { g, a } = r;
  return (
    <>
      <SectionHeader>{m["remote.buzzers"]()}</SectionHeader>
      <div className="grid grid-cols-2 gap-2.5">
        {g.players.map((p) => (
          <Button
            key={`buzz-${p.deviceId || p.name}`}
            variant="destructive"
            className="h-20 touch-manipulation rounded-xl text-base tracking-wider active:scale-95"
            onClick={() => a.buzzPlayer(p.name)}
            onTouchStart={(e) => {
              e.preventDefault();
              a.buzzPlayer(p.name);
            }}
          >
            {p.name.toUpperCase()}
          </Button>
        ))}
        {g.players.length === 0 && (
          <EmptyMessage>{m["remote.noPlayersRegistered"]()}</EmptyMessage>
        )}
      </div>
    </>
  );
}
