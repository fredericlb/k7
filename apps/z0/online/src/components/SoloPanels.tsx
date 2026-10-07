// SoloPanels.tsx — the presentational panels SoloGame draws around the round: the score bar, the
// leaderboard, the end / blocked / intro cards, the last answer and the category jump. They hold
// no game state; every value and handler comes from the walker in SoloGame.tsx.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { SkipForward } from "@frediverse/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frediverse/ui/table";
import type { ReactNode } from "react";
import type { Slot } from "../lib/game";
import { m } from "../paraglide/messages.js";
import { Tip } from "./Tip";

export interface LeaderboardEntry {
  rank: number;
  userName: string;
  score: number;
  isMe?: boolean;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export function Hud({
  score,
  played,
  total,
  canSkip,
  onSkip,
}: {
  score: number;
  played: number;
  total: number;
  canSkip: boolean;
  onSkip: () => void;
}) {
  return (
    <Card className="flex items-center gap-5 px-3.5 py-2.5">
      <Stat label={m["solo.hud.score"]()}>{score}</Stat>
      <Stat label={m["solo.hud.progress"]()}>
        {played} / {total}
      </Stat>
      <Tip label={m["solo.play.giveUp"]()}>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label={m["solo.play.giveUp"]()}
          disabled={!canSkip}
          onClick={onSkip}
        >
          <SkipForward className="size-4" />
        </Button>
      </Tip>
    </Card>
  );
}

function Leaderboard({ entries }: { entries: LeaderboardEntry[] | null }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5 self-center">
      <div className="border-b border-border pb-1.5 text-center text-xs uppercase tracking-[0.15em] text-muted-foreground">
        {m["solo.end.leaderboard"]()}
      </div>
      {entries === null ? (
        <p className="py-1.5 text-center text-sm text-muted-foreground">
          {m["solo.end.loadingBoard"]()}
        </p>
      ) : entries.length === 0 ? (
        <p className="py-1.5 text-center text-sm text-muted-foreground">
          {m["solo.end.boardEmpty"]()}
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <Table className="tabular-nums">
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{m["solo.end.leaderboard"]()}</TableHead>
                <TableHead>{m["solo.hud.score"]()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow
                  key={`${e.rank}-${e.userName}-${i}`}
                  data-state={e.isMe ? "selected" : undefined}
                  className={e.isMe ? "text-primary" : ""}
                >
                  <TableCell className="w-10 text-left">#{e.rank}</TableCell>
                  <TableCell className="max-w-0 text-left">
                    <Tip label={e.userName}>
                      <span className="block truncate text-foreground">
                        {e.userName}
                      </span>
                    </Tip>
                  </TableCell>
                  <TableCell className="text-right">{e.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function EndCard({
  score,
  leaderboard,
  showActions,
  onRestart,
  onExit,
}: {
  score: number;
  leaderboard: LeaderboardEntry[] | null;
  showActions: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="text-2xl font-bold tracking-tight text-green">
          {m["solo.end.title"]()}
        </div>
        <div className="text-5xl font-bold tabular-nums">{score}</div>
        <Leaderboard entries={leaderboard} />
        {showActions && (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={onRestart}>
              {m["solo.end.playAgain"]()}
            </Button>
            <Button variant="outline" size="lg" onClick={onExit}>
              {m["solo.end.back"]()}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BlockedCard({
  leaderboard,
}: {
  leaderboard: LeaderboardEntry[] | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="text-2xl font-bold tracking-tight text-amber">
          {m["solo.blocked.title"]()}
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          {m["solo.blocked.note"]()}
        </p>
        <Leaderboard entries={leaderboard} />
      </CardContent>
    </Card>
  );
}

export function IntroCard({
  index,
  total,
  slot,
  loading,
  progress,
  onStart,
}: {
  index: number;
  total: number;
  slot: Slot;
  loading: boolean;
  progress: number;
  onStart: () => void;
}) {
  const busy = loading || progress < 1;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {m["solo.intro.category"]({ n: index + 1, total })}
        </div>
        <div className="text-2xl font-bold tracking-tight">
          {slot.category?.name}
        </div>
        {slot.category?.notice && (
          <p className="max-w-md text-sm italic text-muted-foreground">
            {slot.category.notice}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {m["solo.intro.summary"]({ songs: slot.songs.length })}
        </p>
        {/* A bespoke bar: commons has no progress component. */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="h-1.5 w-60 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-[width] duration-150 ease-linear"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {loading
              ? m["solo.intro.preloadingProgress"]({
                  percent: Math.round(progress * 100),
                })
              : m["solo.intro.ready"]()}
          </div>
        </div>
        <div className="mt-2">
          <Button size="lg" disabled={busy} onClick={onStart}>
            {busy ? m["solo.intro.preloading"]() : m["solo.intro.start"]()}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LastAnswer({ text }: { text: string }) {
  return (
    <Card className="flex items-baseline gap-2.5 px-3 py-2 text-xs">
      <Badge>{m["solo.play.lastAnswer"]()}</Badge>
      <span className="text-foreground">{text}</span>
    </Card>
  );
}

export function CategoryJump({
  open,
  onClose,
  slots,
  current,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  slots: Slot[];
  current: number;
  onJump: (i: number) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-sm uppercase tracking-[0.15em]">
            {m["solo.jump.title"]()}
          </DialogTitle>
        </DialogHeader>
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {slots.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a slot has no id, and the list never reorders while open.
            <li key={i}>
              <Button
                variant={i === current ? "secondary" : "outline"}
                className="w-full justify-between font-normal"
                onClick={() => onJump(i)}
              >
                <span className="truncate">{s.category?.name ?? "—"}</span>
                {i === current ? (
                  <Badge variant="tag">{m["solo.jump.current"]()}</Badge>
                ) : (
                  <Badge>{s.songs.length}</Badge>
                )}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="w-full">
              {m["solo.jump.cancel"]()}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
