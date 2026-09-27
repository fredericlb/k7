// Tray.tsx — the engine tab: what MainActivity drew natively before this app had a WebView. It
// draws the supervisor's snapshot and sends the few commands a phone needs — connect a studio,
// disconnect one, trust a private CA, quit. See docs/android.md.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { useEffect, useState } from "react";
import { St0Engine, type SupervisorState } from "./native";

export interface TrayProps {
  state: SupervisorState | null;
  engineExit: number | null;
  /** st0's origin for each connected studio. */
  studios: string[];
  /** The one the app tabs open. */
  studio: string | null;
  onChooseStudio: (origin: string) => void;
}

export function Tray({
  state,
  engineExit,
  studios,
  studio,
  onChooseStudio,
}: TrayProps) {
  const [address, setAddress] = useState("");
  const [lan, setLan] = useState<string | null>(null);

  useEffect(() => {
    St0Engine.lanAddress().then(({ address }) => setLan(address ?? null));
  }, []);

  const connect = () => {
    const url = address.trim();
    if (url) St0Engine.command({ cmd: "weburi.add", arg: url });
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

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Studios</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            none connected — connect one to open st0, pl8 and k7 here
          </p>
        ) : null}
        {rows.map((row) => (
          <div key={row.url} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{row.url}</span>
            {row.removable ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  St0Engine.command({ cmd: "weburi.remove", arg: row.url })
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        {studios.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Tabs open</span>
            <select
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1"
              value={studio ?? ""}
              onChange={(e) => onChooseStudio(e.target.value)}
            >
              {studios.map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
      </section>

      <PrivateCa />

      <Button variant="outline" onClick={() => St0Engine.quit()}>
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

// Collapsed unless one is already trusted: a studio with a public certificate, the usual case, needs nothing here.
function PrivateCa() {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    St0Engine.casInfo().then(({ count }) => {
      setCount(count);
      setOpen(count > 0);
    });
  }, []);

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
    <section className="flex flex-col gap-2">
      <Button
        variant="ghost"
        className="justify-start px-0"
        onClick={() => setOpen(!open)}
      >
        Private CA (optional) {open ? "▾" : "▸"}
      </Button>
      {open ? (
        <>
          <p className="text-sm text-muted-foreground">
            Only needed when your studio's HTTPS certificate is signed by a
            certificate authority of your own — a home server or a company
            network running its own CA. Studios with a public certificate, such
            as Let's Encrypt, connect without anything here.
          </p>
          <p className="text-sm text-muted-foreground">
            Android does not let apps use the CAs installed in Settings, so a
            private one is added here instead: pick its certificate file (.pem,
            .crt or .der). It is trusted by the engine's connection to the
            studio and by the st0, pl8 and k7 tabs alike.
          </p>
          <p className="text-sm">{base}</p>
          {said ? <p className="text-sm">{said}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(() => St0Engine.importCa(), "adding")}
            >
              Trust a CA certificate…
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const done = await St0Engine.forgetCas();
                  return { ...done, said: "trusting Android's CAs only" };
                }, "forgetting")
              }
            >
              Forget trusted CAs
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
