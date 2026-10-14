import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useMomentShare } from "../components/MomentServerShare";
import { m } from "../paraglide/messages.js";
import type { Moment } from "../types";
import { MomentDetailView } from "../views/MomentDetailView";

interface Props {
  momentId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenSession: (sessionUid: string, seekTo: number) => void;
}

export function MomentDetailContainer({
  momentId,
  onBack,
  onDeleted,
  onOpenSession,
}: Props) {
  const [moment, setMoment] = useState<Moment | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Its copy on a paired server: a moment can be shared, its session never.
  const share = useMomentShare(true, momentId);

  const load = useCallback(async () => {
    try {
      setMoment(await api.getMoment(momentId));
    } catch {
      setNotFound(true);
    }
  }, [momentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) return <p className="muted">{m["moment.gone"]()}</p>;
  if (!moment) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <MomentDetailView
      moment={moment}
      clipUrl={api.momentPageClipUrl(momentId)}
      onBack={onBack}
      onDelete={async () => {
        await api.deleteMoment(momentId);
        onDeleted();
      }}
      onOpenSession={
        moment.sessionAvailable && moment.sessionUid
          ? () => onOpenSession(moment.sessionUid!, moment.startSec)
          : null
      }
      onAddMarker={async (atSec) => {
        await api.addMomentMarker(momentId, { atSec });
        await load();
      }}
      onUpdateMarker={async (markerId, comment) => {
        await api.updateMomentMarker(momentId, markerId, comment);
        await load();
      }}
      onDeleteMarker={async (markerId) => {
        await api.deleteMomentMarker(momentId, markerId);
        await load();
      }}
      share={{
        state: share.stateOf(momentId),
        host: share.host,
        // Sharing an unvalidated moment cuts its clip first, so the page reloads to show it.
        onShare: async () => {
          await share.share(momentId);
          await load();
        },
      }}
    />
  );
}
