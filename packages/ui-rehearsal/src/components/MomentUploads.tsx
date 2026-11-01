// MomentUploads.tsx — every moment of this machine sent up to the account's active server on its own, while k7 is
// open: a few seconds after start and every few minutes, each one the server lacks goes as the moment page's own send
// does, a row of the download manager. Renders nothing. ../../docs/recordings.md, "Moments go up on their own".

import { queueDownload } from "@studio/http-client/downloads";
import { useEffect } from "react";
import { api } from "../api";
import { momentsToSend, serverLabel } from "../consolidation";
import { m } from "../paraglide/messages.js";

const FIRST_MS = 10_000;
const EVERY_MS = 3 * 60_000;

// A moment the server refused stays here until the next start: sent again at every pass, it would fail every time.
const refused = new Set<string>();

async function sendWaiting(): Promise<void> {
  const { serverOnly, server } = await api.consolidationServers();
  if (!serverOnly || !server) return;
  const todo = momentsToSend(await api.listMoments(), server).filter(
    (x) => !refused.has(`${x.id}:${server.id}`),
  );
  const label = serverLabel(server);
  await Promise.allSettled(
    todo.map((x) =>
      queueDownload(
        {
          key: `moment:${x.id}:${server.id}`,
          kind: "moment",
          label: m["moment.consolidate.row"]({
            name: x.text.trim() || m["moment.consolidate.unnamed"](),
            server: label,
          }),
        },
        () => api.consolidateMoment(x.id, server.id),
      ).catch(() => refused.add(`${x.id}:${server.id}`)),
    ),
  );
}

/** Mounted once on a machine (the tray, a phone); `enabled` false on a server, whose moments are its own. */
export function MomentUploads({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const run = () => void sendWaiting().catch(() => {});
    const first = setTimeout(run, FIRST_MS);
    const every = setInterval(run, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [enabled]);
  return null;
}
