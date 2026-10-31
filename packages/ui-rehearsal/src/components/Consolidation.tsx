// Consolidation.tsx — on a local instance, consolidating a moment asks which server to send it to: the
// provider knows whether this instance consolidates itself, opens the dialog, and tracks each send.
// Outside a provider, or on a server, nothing changes: the moment is consolidated here. ../../docs/recordings.md.

import { Button } from "@frediverse/ui/button";
import {
  CloudCheck,
  CloudUpload,
  ExternalLink,
  Loader2,
} from "@frediverse/ui/icons";
import { queueDownload } from "@studio/http-client/downloads";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { serverLabel } from "../consolidation";
import { m } from "../paraglide/messages.js";
import type { Consolidation, ConsolidationServer } from "../types";
import { ConsolidateDialog } from "./ConsolidateDialog";

/** What the dialog needs of a moment: its id, a name for the sentence, where it already is. */
export interface ConsolidatedMoment {
  id: string;
  text: string;
  consolidations?: Consolidation[];
}

interface Consolidating {
  /** True on a local instance: a moment is consolidated on a server, chosen in a dialog. */
  serverOnly: boolean;
  open: (moment: ConsolidatedMoment) => void;
  /** The server a moment is being sent to right now, as its label; null when none. */
  sendingTo: (id: string) => string | null;
  /** What went wrong with the last send of a moment, in words; null when nothing did. */
  failure: (id: string) => string | null;
}

const NONE: Consolidating = {
  serverOnly: false,
  open: () => {},
  sendingTo: () => null,
  failure: () => null,
};

const Context = createContext<Consolidating>(NONE);

/** Whether moments are consolidated here or on a server, and the way to send one. */
export const useConsolidation = (): Consolidating => useContext(Context);

/** Around a page of moments; `onConsolidated` reloads it once a send has landed. */
export function ConsolidationProvider({
  onConsolidated,
  children,
}: {
  onConsolidated: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [serverOnly, setServerOnly] = useState(false);
  const [moment, setMoment] = useState<ConsolidatedMoment | null>(null);
  const [sending, setSending] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api
      .consolidationServers()
      .then((s) => alive && setServerOnly(s.serverOnly))
      // A backend that does not answer this (a server browsed from the tray) consolidates itself.
      .catch(() => alive && setServerOnly(false));
    return () => {
      alive = false;
    };
  }, []);

  const send = useCallback(
    (target: ConsolidatedMoment, server: ConsolidationServer) => {
      const label = serverLabel(server);
      const name = target.text.trim() || m["moment.consolidate.unnamed"]();
      setSending((s) => ({ ...s, [target.id]: label }));
      setFailures(({ [target.id]: _, ...rest }) => rest);
      void queueDownload(
        {
          key: `moment:${target.id}:${server.id}`,
          kind: "moment",
          label: m["moment.consolidate.row"]({ name, server: label }),
        },
        () => api.consolidateMoment(target.id, server.id),
      )
        .then(() => onConsolidated())
        .catch((e: Error) =>
          setFailures((f) => ({ ...f, [target.id]: e.message })),
        )
        .finally(() => setSending(({ [target.id]: _, ...rest }) => rest));
    },
    [onConsolidated],
  );

  const value = useMemo<Consolidating>(
    () => ({
      serverOnly,
      open: setMoment,
      sendingTo: (id) => sending[id] ?? null,
      failure: (id) => failures[id] ?? null,
    }),
    [serverOnly, sending, failures],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {moment && (
        <ConsolidateDialog
          moment={moment}
          onClose={() => setMoment(null)}
          onConfirm={(server) => {
            send(moment, server);
            setMoment(null);
          }}
        />
      )}
    </Context.Provider>
  );
}

/** Where a server's copy of the moment opens: its rehearsal page, under the machine's moment id. */
const pageOn = (c: Consolidation, id: string): string =>
  `${c.origin}/rehearsal/moments/${encodeURIComponent(id)}`;

/** The servers a moment was consolidated on, each a link to its page there, and a send under way or failed. */
export function ConsolidationState({ moment }: { moment: ConsolidatedMoment }) {
  const c = useConsolidation();
  const sending = c.sendingTo(moment.id);
  const failure = c.failure(moment.id);
  const done = moment.consolidations ?? [];
  if (!done.length && !sending && !failure) return null;
  return (
    <span className="moment-consolidations small">
      {done.map((x) => (
        <a
          key={x.link}
          href={pageOn(x, moment.id)}
          target="_blank"
          rel="noreferrer"
          className="moment-placement synced"
        >
          <CloudCheck className="size-3.5" />{" "}
          {m["moment.consolidate.on"]({ server: serverLabel(x) })}{" "}
          <ExternalLink className="size-3" />
        </a>
      ))}
      {sending && (
        <span className="muted">
          <Loader2 className="size-3.5 animate-spin" />{" "}
          {m["moment.consolidate.sending"]({ server: sending })}
        </span>
      )}
      {failure && <span className="error">{failure}</span>}
    </span>
  );
}

/** The local instance's button: choose a server to consolidate the moment on. */
export function ConsolidateButton({ moment }: { moment: ConsolidatedMoment }) {
  const c = useConsolidation();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!!c.sendingTo(moment.id)}
      title={m["moment.consolidate.hint"]()}
      onClick={() => c.open(moment)}
    >
      <CloudUpload className="size-4" /> {m["moment.consolidate.action"]()}
    </Button>
  );
}
