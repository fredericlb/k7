import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ConsolidationProvider } from "../components/Consolidation";
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
  /** Its recording at the moment's start: the session's page when a session saved it. */
  onOpenRecording: (moment: Moment) => void;
}

export function MomentDetailContainer({
  momentId,
  onBack,
  onDeleted,
  onOpenRecording,
}: Props) {
  const [moment, setMoment] = useState<Moment | null>(null);
  const { loadError, setLoadError, actionError, guard } = useDetailState();
  // Its copy on the main server, for the icon: a moment goes up, its session never.
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
    <ConsolidationProvider onConsolidated={load}>
      <ActionFailure message={actionError} />
      <MomentDetailView
        moment={moment}
        clipUrl={api.momentPageClipUrl(momentId)}
        onBack={onBack}
        onDelete={guard(async () => {
          await api.deleteMoment(momentId);
          onDeleted();
        })}
        onOpenRecording={
          moment.recordingAvailable ? () => onOpenRecording(moment) : null
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
        share={{ state: share.stateOf(momentId), host: share.host }}
      />
    </ConsolidationProvider>
  );
}
