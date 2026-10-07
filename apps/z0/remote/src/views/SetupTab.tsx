// The SETUP tab: the session, simulated players, the two registration switches, and the roster.
// The roster's per-row actions open dialogs whose state lives in the shared bag, not here.

import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { ArrowLeftRight, Pencil, TriangleAlert } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { cn } from "@frediverse/ui/lib/utils";
import { Switch } from "@frediverse/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frediverse/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@frediverse/ui/tooltip";
import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";
import type { Remote } from "../remote/useRemote";
import { EmptyMessage, SectionHeader } from "./ScoringTabs";

function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <Label htmlFor={id} className="text-sm text-foreground">
        {label}
      </Label>
      {/* The span carries the tooltip, since a disabled switch takes no pointer events. */}
      <Hint text={hint}>
        <span>
          <Switch
            id={id}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
          />
        </span>
      </Hint>
    </div>
  );
}

export function SetupTab({
  r,
  sessionPicker,
}: {
  r: Remote;
  sessionPicker: ReactNode;
}) {
  const { g, a, render } = r;
  const isDeviceConnected = (deviceId: string) =>
    !!deviceId && g.connectedDevices.has(deviceId);

  return (
    <>
      {sessionPicker}

      <SectionHeader>{m["remote.addPlayer"]()}</SectionHeader>
      <form
        className="flex shrink-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void a.addPlayer();
        }}
      >
        <Input
          className="h-10 uppercase"
          type="text"
          maxLength={12}
          autoComplete="off"
          aria-label={m["remote.namePlaceholder"]()}
          placeholder={m["remote.namePlaceholder"]()}
          value={g.newPlayerName}
          onChange={(e) => {
            g.newPlayerName = e.target.value;
            render();
          }}
        />
        <Button type="submit" size="lg">
          {m["remote.add"]()}
        </Button>
      </form>
      {g.createPlayerError && (
        <Alert variant="destructive" className="shrink-0 py-2">
          <TriangleAlert />
          <AlertDescription>{g.createPlayerError}</AlertDescription>
        </Alert>
      )}

      <SwitchRow
        id="registration-lock"
        label={
          g.registrationLocked
            ? m["remote.registrationLocked"]()
            : m["remote.registrationOpen"]()
        }
        hint={
          g.registrationLocked
            ? m["remote.registrationUnlockHint"]()
            : m["remote.registrationLockHint"]()
        }
        checked={g.registrationLocked}
        disabled={!g.registrationLocked && g.players.length === 0}
        onCheckedChange={() =>
          void a.setRegistrationLocked(!g.registrationLocked)
        }
      />
      <SwitchRow
        id="politeness"
        label={m["remote.politenessDelay"]()}
        hint={m["remote.politenessDelayHint"]()}
        checked={g.politenessEnabled}
        onCheckedChange={a.togglePoliteness}
      />

      <SectionHeader className="mt-2">
        {m["remote.playersCount"]({ count: g.players.length })}
      </SectionHeader>
      {g.players.length === 0 ? (
        <EmptyMessage>{m["remote.noPlayersYet"]()}</EmptyMessage>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m["remote.namePlaceholder"]()}</TableHead>
              <TableHead />
              <TableHead className="text-right">
                {m["remote.score"]()}
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {g.players.map((p) => {
              const online = isDeviceConnected(p.deviceId);
              return (
                <TableRow
                  key={p.name}
                  className={cn(
                    g.buzzingPlayers.has(p.name) && "bg-green/15 text-green",
                  )}
                >
                  <TableCell className="max-w-28 truncate font-semibold">
                    {p.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={online ? "default" : "rec"}
                        className={cn(online && "bg-green/15 text-green")}
                      >
                        {online ? 1 : 0}
                      </Badge>
                      <span className="max-w-16 truncate text-[10px] text-muted-foreground">
                        {p.deviceId || "—"}
                      </span>
                      {p.deviceId && (
                        <Hint text={m["remote.unlockDevice"]()}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-amber"
                            aria-label={m["remote.unlockDevice"]()}
                            onClick={() => void a.unlockPlayerDevice(p.name)}
                          >
                            <ArrowLeftRight className="size-4" />
                          </Button>
                        </Hint>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-primary">
                    {p.score}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Hint text={m["remote.editScore"]()}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={m["remote.editScore"]()}
                          onClick={() => {
                            g.scoreEditorPlayer = p.name;
                            g.scoreEditorValue = p.score;
                            g.scoreEditorOpen = true;
                            render();
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </Hint>
                      <Hint text={m["remote.punish"]()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          aria-label={m["remote.punish"]()}
                          onClick={() => {
                            g.punishTarget = p.name;
                            g.punishConfirmOpen = true;
                            render();
                          }}
                        >
                          −2k
                        </Button>
                      </Hint>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
