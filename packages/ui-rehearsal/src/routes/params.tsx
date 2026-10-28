// params.tsx — one wrapper per detail route: each reads the URL params and forwards them to a
// container keyed on the id, so moving between two items of a kind reloads the container.

import { useParams, useSearchParams } from "react-router-dom";
import { MomentDetailContainer } from "../containers/MomentDetailContainer";
import { PageDetailContainer } from "../containers/PageDetailContainer";
import { ReleaseDetailContainer } from "../containers/ReleaseDetailContainer";
import { SessionDetailContainer } from "../containers/SessionDetailContainer";
import type { Release, Session } from "../types";

export function SessionRoute(props: {
  allTags: string[];
  onBack: () => void;
  onChange: () => void;
  onResume: (session: Session) => Promise<void>;
}) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const t = sp.get("t");
  return (
    <SessionDetailContainer
      key={id}
      sessionId={id ?? ""}
      seekTo={t != null ? Number(t) : undefined}
      {...props}
    />
  );
}

export function ReleaseRoute(props: {
  onDeleted: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  const { id } = useParams();
  return <ReleaseDetailContainer key={id} releaseId={id ?? ""} {...props} />;
}

export function PageRoute(props: {
  allReleases: Release[];
  onChange: () => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const { id } = useParams();
  return <PageDetailContainer key={id} pageId={id ?? ""} {...props} />;
}

export function MomentRoute(props: {
  onBack: () => void;
  onDeleted: () => void;
  onOpenSession: (sessionUid: string, seekTo?: number) => void;
}) {
  const { id } = useParams();
  return <MomentDetailContainer key={id} momentId={id ?? ""} {...props} />;
}
