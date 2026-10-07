// The session's panels: the websocket log, the virtual buzzers and the ranked players.
// The log stays a monospace list rather than a Table: `flex-col-reverse` is what pins it to the newest entry.

import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { Button } from "@frediverse/ui/button";
import { X } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import { Table, TableBody, TableCell, TableRow } from "@frediverse/ui/table";
import { useMemo, useState } from "react";
import type { MonitorState } from "../lib/monitor";
import type { MonitorSystem } from "../lib/system";
import { useVirtualBuzzersState } from "../lib/virtualBuzzers";
import { Panel } from "./panels";

const EMPTY = "text-xs italic text-muted-foreground";

function medal(i: number): string {
  if (i === 0) return "①";
  if (i === 1) return "②";
  if (i === 2) return "③";
  return " ";
}

export function TrafficPanel({ mon }: { mon: MonitorState }) {
  return (
    <Panel
      title="WebSocket traffic"
      className="h-full"
      bodyClassName="flex flex-1 flex-col-reverse overflow-auto font-mono text-xs"
    >
      {mon.wsEntries.length === 0 && (
        <div className={EMPTY}>waiting for messages…</div>
      )}
      {mon.wsEntries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex gap-3 whitespace-pre py-px",
            entry.direction === "info" && "italic text-muted-foreground",
          )}
        >
          <span className="shrink-0 text-muted-foreground">{entry.ts}</span>
          <span className="shrink-0">{entry.type.padEnd(16, " ")}</span>
          <span className="text-muted-foreground">{entry.payload}</span>
        </div>
      ))}
    </Panel>
  );
}

export function BuzzersPanel({ sys }: { sys: MonitorSystem }) {
  const { buzzers } = useVirtualBuzzersState(sys.virtual);
  const [newBuzzerName, setNewBuzzerName] = useState("");
  const [createError, setCreateError] = useState("");

  function createVirtualBuzzer(e: React.FormEvent) {
    e.preventDefault();
    const err = sys.virtual.create(newBuzzerName);
    if (err) {
      setCreateError(err);
      return;
    }
    setCreateError("");
    setNewBuzzerName("");
  }

  return (
    <Panel title="Virtual buzzers" bodyClassName="flex flex-col gap-2">
      <form className="flex gap-1.5" onSubmit={createVirtualBuzzer}>
        <Input
          className="h-7 text-xs"
          type="text"
          maxLength={12}
          placeholder="player name"
          aria-label="player name"
          autoComplete="off"
          value={newBuzzerName}
          onChange={(e) => setNewBuzzerName(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!newBuzzerName.trim()}>
          Create
        </Button>
      </form>
      {createError && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription>{createError}</AlertDescription>
        </Alert>
      )}
      {buzzers.length === 0 && <div className={EMPTY}>no virtual buzzers</div>}
      {buzzers.length > 0 && (
        <Table className="text-xs">
          <TableBody>
            {buzzers.map((b) => (
              <TableRow key={b.token}>
                <TableCell className="w-4 px-1">
                  <span
                    className={cn(
                      "block size-2 rounded-full",
                      b.connected && b.registered ? "bg-green" : "bg-secondary",
                    )}
                  />
                </TableCell>
                <TableCell className="w-full px-1">{b.name}</TableCell>
                <TableCell className="px-1 text-right tabular-nums text-muted-foreground">
                  {b.deviceId || "—"}
                </TableCell>
                <TableCell className="px-1">
                  <div className="flex justify-end gap-1">
                    {b.connected && !b.registered ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => sys.virtual.join(b.name)}
                      >
                        Join
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        disabled={!b.connected || !b.registered}
                        onClick={() => sys.virtual.buzz(b.name)}
                      >
                        Buzz
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title={`remove ${b.name}`}
                      aria-label={`remove ${b.name}`}
                      onClick={() => sys.virtual.remove(b.name)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function PlayersPanel({ mon }: { mon: MonitorState }) {
  const rankedPlayers = useMemo(
    () => [...mon.players].sort((a, b) => b.score - a.score),
    [mon.players],
  );
  return (
    <Panel
      title={`Players (${rankedPlayers.length})`}
      className="flex-1"
      bodyClassName="overflow-auto"
    >
      {rankedPlayers.length === 0 && (
        <div className={EMPTY}>no players yet</div>
      )}
      {rankedPlayers.length > 0 && (
        <Table>
          <TableBody>
            {rankedPlayers.map((p, i) => (
              <TableRow key={p.name} className={cn(i < 3 && "font-semibold")}>
                <TableCell className="w-6 px-1 text-right tabular-nums text-muted-foreground">
                  {i + 1}
                </TableCell>
                <TableCell className="w-4 px-1">{medal(i)}</TableCell>
                <TableCell
                  className={cn(
                    "w-full px-1",
                    mon.buzzing.has(p.name) && "text-amber",
                  )}
                >
                  {p.name}
                </TableCell>
                <TableCell className="px-1 text-right tabular-nums">
                  {Math.round(p.score)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
