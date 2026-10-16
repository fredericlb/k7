// useDetailState.tsx — what a detail page shows when its record fails to load or one of its writes fails.
// A guarded write still rethrows: a view that keeps its form filled on failure relies on the throw.

import { Button } from "@frediverse/ui/button";
import { type ReactNode, useCallback, useState } from "react";
import { ApiError } from "../api";
import { m } from "../paraglide/messages.js";

export function useDetailState() {
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const guard = useCallback(
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        setActionError(null);
        try {
          return await fn(...args);
        } catch (e) {
          setActionError(
            m["common.actionFailed"]({ message: (e as Error).message }),
          );
          throw e;
        }
      },
    [],
  );

  return { loadError, setLoadError, actionError, guard };
}

/** The page in place of a record that never came: gone on a 404, otherwise the reason and a retry. */
export function LoadFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): ReactNode {
  if (error instanceof ApiError && error.status === 404)
    return <p className="muted">{m["common.gone"]()}</p>;
  return (
    <p className="error">
      {m["common.loadFailed"]({ message: (error as Error).message })}{" "}
      <Button variant="outline" size="sm" onClick={onRetry}>
        {m["common.retry"]()}
      </Button>
    </p>
  );
}

/** The line above a detail view naming the write that failed. */
export function ActionFailure({ message }: { message: string | null }) {
  return message ? <p className="error">{message}</p> : null;
}
