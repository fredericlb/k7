// useGraphAt.ts — the compiled graph of ONE folder other than the open project's: an assembly
// template's, which is what its builder lists params from. Null while closed or unreadable.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { WebGraph } from "../types";

export function useGraphAt(folder: string | null): WebGraph | null {
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (!folder) return void setGraph(null);
    let live = true;
    void api
      .graphAt(folder)
      .then((g) => live && setGraph(g))
      .catch(() => live && setGraph(null));
    return () => {
      live = false;
    };
  }, [folder]);
  return graph;
}
