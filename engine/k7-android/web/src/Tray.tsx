// Tray.tsx — this page's one screen, seen while no studio app covers it: the supervisor's snapshot
// and the few commands a phone needs — connect a studio, disconnect one, pair a LAN device, trust a private CA, quit.
// With a studio open, k7's settings draw the same (apps/k7/frontend/src/settings/AndroidEngineSection.tsx).
// The forms are collapsed: the phone's own studio needs none of them, and the first screen is the engine's state.

import { Button } from "@frediverse/ui/button";
import { ChevronDown, ChevronRight } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type ReactNode, useEffect, useState } from "react";
import { K7Runtime, type SupervisorState } from "./native";
import { Pairing } from "./Pairing";

export interface TrayProps {
  state: SupervisorState | null;
  engineExit: number | null;
  /** The open studio's certificate was refused: the private CA is the likely fix, so it opens. */
  certFailed: boolean;
}

export function Tray({ state, engineExit, certFailed }: TrayProps) {
  const [address, setAddress] = useState("");
  const [lan, setLan] = useState<string | null>(null);
  const [studiosOpen, setStudiosOpen] = useState(false);

  useEffect(() => {
    K7Runtime.lanAddress().then(({ address }) => setLan(address ?? null));
  }, []);

  const connect = () => {
    const url = address.trim();
    if (url) K7Runtime.command({ cmd: "weburi.add", arg: url });
  };

  const rows = state?.instances ?? [];
  const check = state?.instanceCheck;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6 pb-[calc(1.5rem+var(--safe-bottom))]">
      <section className="flex flex-col gap-1">
        <p className="text-lg">{engineLine(state, engineExit, lan)}</p>
        {rows.length > 0 && engineExit == null ? (
          <p className="text-sm text-muted-foreground">
            {state?.lastHeartbeatOk
              ? "listed at every studio"
              : "a studio is not answering"}
          </p>
        ) : null}
      </section>

      <Disclosure
        label="Connect to another studio"
        open={
          studiosOpen ||
          check?.state === "checking" ||
          check?.state === "refused"
        }
        onToggle={() => setStudiosOpen(!studiosOpen)}
      >
        <p className="text-sm text-muted-foreground">
          This phone runs its own k7. A studio on a server is optional: its
          address adds it here, and k7's settings pick which one opens.
        </p>
        {rows.map((row) => (
          <div key={row.url} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{row.url}</span>
            {row.removable ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  K7Runtime.command({ cmd: "weburi.remove", arg: row.url })
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <Input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://studio.example"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button type="submit">Connect</Button>
        </form>
        {check?.state === "checking" ? (
          <p className="text-sm text-muted-foreground">checking {check.url}…</p>
        ) : null}
        {check?.state === "refused" ? (
          <p className="text-sm text-destructive">{check.message}</p>
        ) : null}
      </Disclosure>

      <Pairing
        requests={state?.pairRequests ?? []}
        devices={state?.pairedDevices ?? []}
      />

      <PrivateCa certFailed={certFailed} />

      <Button variant="outline" onClick={() => K7Runtime.quit()}>
        Quit
      </Button>
    </main>
  );
}

function engineLine(
  state: SupervisorState | null,
  engineExit: number | null,
  lan: string | null,
): string {
  if (engineExit != null) return `engine stopped (${engineExit})`;
  if (!state) return "starting…";
  if (state.status === "running")
    return `engine running on ws://${lan ?? "127.0.0.1"}:${state.enginePort}`;
  if (state.status === "error") return `engine: ${state.error}`;
  return `engine ${state.status ?? "starting…"}`;
}

// A heading that shows its section only once asked, so the tray's first screen is the state and not the forms.
function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-2">
      <Button
        variant="ghost"
        className="justify-start px-0 text-muted-foreground"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Chevron className="size-4" />
        {label}
      </Button>
      {open ? children : null}
    </section>
  );
}

// Collapsed unless one is already trusted or the studio's certificate was just refused: a public certificate, the usual case, needs nothing here.
function PrivateCa({ certFailed }: { certFailed: boolean }) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    K7Runtime.casInfo().then(({ count }) => {
      setCount(count);
      setOpen((was) => was || count > 0);
    });
  }, []);

  useEffect(() => {
    if (certFailed) setOpen(true);
  }, [certFailed]);

  // The supervisor reads its roots once, at start: each change restarts it, and it adopts the running engine.
  const run = async (
    change: () => Promise<{ count: number; said?: string }>,
    doing: string,
  ) => {
    setBusy(true);
    setSaid(`${doing} — reconnecting…`);
    try {
      const done = await change();
      setCount(done.count);
      setSaid(done.said ?? null);
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const base =
    count == null || count === 0
      ? "Android's CAs only"
      : `Android's CAs and ${count} of yours`;

  return (
    <Disclosure
      label="Private CA (optional)"
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {certFailed ? (
        <p className="text-sm text-destructive">
          The studio's certificate is not trusted. If it is signed by a CA of
          your own, add that CA below.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Only needed when your studio's HTTPS certificate is signed by a
        certificate authority of your own — a home server or a company network
        running its own CA. Studios with a public certificate, such as Let's
        Encrypt, connect without anything here.
      </p>
      <p className="text-sm text-muted-foreground">
        Android does not let apps use the CAs installed in Settings, so a
        private one is added here instead: pick its certificate file (.pem, .crt
        or .der). It is trusted by the engine's connection to the studio and by
        k7 alike.
      </p>
      <p className="text-sm">{base}</p>
      {said ? <p className="text-sm">{said}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => run(() => K7Runtime.importCa(), "adding")}
        >
          Trust a CA certificate…
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const done = await K7Runtime.forgetCas();
              return { ...done, said: "trusting Android's CAs only" };
            }, "forgetting")
          }
        >
          Forget trusted CAs
        </Button>
      </div>
    </Disclosure>
  );
}
