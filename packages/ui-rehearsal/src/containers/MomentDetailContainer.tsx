import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useMomentShare } from "../components/MomentServerShare";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
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
  const { loadError, setLoadError, actionError, guard } = useDetailState();
  // Its copy on a paired server: a moment can be shared, its session never.
  const share = useMomentShare(true, momentId);

  const load = useCallback(async () => {
    try {
      setMoment(await api.getMoment(momentId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [momentId, setLoadError]);

  useEffect(() => {
    load();
  }, [load]);

  if (!moment && loadError != null)
    return <LoadFailure error={loadError} onRetry={load} />;
  if (!moment) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <ActionFailure message={actionError} />
      <MomentDetailView
        moment={moment}
        clipUrl={api.momentPageClipUrl(momentId)}
        onBack={onBack}
        onDelete={guard(async () => {
          await api.deleteMoment(momentId);
          onDeleted();
        })}
        onOpenSession={
          moment.sessionAvailable && moment.sessionUid
            ? () => onOpenSession(moment.sessionUid!, moment.startSec)
            : null
        }
        onAddMarker={guard(async (atSec: number) => {
          await api.addMomentMarker(momentId, { atSec });
          await load();
        })}
        onUpdateMarker={guard(async (markerId: string, comment: string) => {
          await api.updateMomentMarker(momentId, markerId, comment);
          await load();
        })}
        onDeleteMarker={guard(async (markerId: string) => {
          await api.deleteMomentMarker(momentId, markerId);
          await load();
        })}
        share={{
          state: share.stateOf(momentId),
          host: share.host,
          // Sharing an unvalidated moment cuts its clip first, so the page reloads to show it.
          onShare: guard(async () => {
            await share.share(momentId);
            await load();
          }),
        }}
      />
    </>
  );
}
